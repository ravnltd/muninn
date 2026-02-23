/**
 * OAuth Route Handlers
 *
 * Implements RFC 7591 (Dynamic Client Registration), RFC 6749 (Authorization Code),
 * RFC 7636 (PKCE), and RFC 7009 (Token Revocation) for Claude Code's OAuth flow.
 */

import { Hono } from "hono";
import { z } from "zod";
import { getManagementDb } from "../db/management";
import { ClientsStore } from "./clients-store";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  revokeToken,
} from "./provider";
import { authenticateTenant } from "../tenants/manager";
import { renderAuthorizePage, renderAuthorizeError } from "./authorize-page";

const auth = new Hono();

// ============================================================================
// In-memory security stores (CSRF, rate limiting)
// ============================================================================

const CSRF_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomUUID();
if (!process.env.CSRF_SECRET) {
  console.warn("[muninn-cloud] WARNING: CSRF_SECRET not set — using random value. OAuth forms will break on restart. Set CSRF_SECRET in .env.");
}

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

const REGISTER_MAX_PER_HOUR = 10;
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const registerAttempts = new Map<string, { count: number; windowStart: number }>();

/**
 * Generate an HMAC-signed stateless CSRF token.
 * Format: timestamp:nonce:signature (survives restarts, zero storage).
 */
async function generateCsrfToken(): Promise<string> {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID().slice(0, 8);
  const data = `${timestamp}:${nonce}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(CSRF_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const signature = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `${data}:${signature}`;
}

/**
 * Verify and consume a stateless CSRF token.
 */
async function verifyCsrfToken(token: string): Promise<boolean> {
  const parts = token.split(":");
  if (parts.length !== 3) return false;
  const [timestamp, nonce, signature] = parts;
  const age = Date.now() - Number(timestamp);
  if (age > CSRF_TTL_MS || age < 0) return false;

  const data = `${timestamp}:${nonce}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(CSRF_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return signature === expected;
}

// Periodic cleanup every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of loginAttempts) {
    if (now - val.windowStart > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }
  for (const [key, val] of registerAttempts) {
    if (now - val.windowStart > REGISTER_WINDOW_MS) registerAttempts.delete(key);
  }
}, 30 * 60 * 1000).unref();

// ============================================================================
// Dynamic Client Registration (RFC 7591)
// ============================================================================

const RegisterInput = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().max(200).optional(),
  grant_types: z.array(z.string()).optional(),
});

auth.post("/register", async (c) => {
  // Per-IP rate limiting on registration
  const ip = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const regAttempt = registerAttempts.get(ip);
  if (regAttempt && regAttempt.count >= REGISTER_MAX_PER_HOUR && now - regAttempt.windowStart < REGISTER_WINDOW_MS) {
    return c.json({ error: "rate_limit", error_description: "Too many registrations" }, 429);
  }
  if (regAttempt && now - regAttempt.windowStart < REGISTER_WINDOW_MS) {
    registerAttempts.set(ip, { count: regAttempt.count + 1, windowStart: regAttempt.windowStart });
  } else {
    registerAttempts.set(ip, { count: 1, windowStart: now });
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_request" }, 400);

  const parsed = RegisterInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_client_metadata", error_description: parsed.error.errors[0]?.message }, 400);
  }

  const mgmtDb = await getManagementDb();
  const store = new ClientsStore(mgmtDb);
  const client = await store.registerClient(
    parsed.data.redirect_uris,
    parsed.data.client_name,
    parsed.data.grant_types
  );

  return c.json({
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uris: client.redirect_uris,
    client_name: client.client_name,
    grant_types: client.grant_types,
  }, 201);
});

// ============================================================================
// Authorization Endpoint (RFC 6749 §3.1)
// ============================================================================

auth.get("/authorize", async (c) => {
  const clientId = c.req.query("client_id");
  const redirectUri = c.req.query("redirect_uri");
  const state = c.req.query("state");
  const codeChallenge = c.req.query("code_challenge");
  const codeChallengeMethod = c.req.query("code_challenge_method");
  const scope = c.req.query("scope");
  const responseType = c.req.query("response_type");

  if (!clientId || !redirectUri) {
    return c.html(renderAuthorizeError("Missing client_id or redirect_uri"), 400);
  }
  if (responseType && responseType !== "code") {
    return c.html(renderAuthorizeError("Unsupported response_type. Only 'code' is supported."), 400);
  }
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return c.html(renderAuthorizeError("Unsupported code_challenge_method. Only S256 is supported."), 400);
  }

  // Validate client exists
  const mgmtDb = await getManagementDb();
  const store = new ClientsStore(mgmtDb);
  const client = await store.getClient(clientId);
  if (!client) {
    return c.html(renderAuthorizeError("Unknown client_id"), 400);
  }

  // Validate redirect_uri is registered
  if (!client.redirect_uris.includes(redirectUri)) {
    return c.html(renderAuthorizeError("redirect_uri not registered for this client"), 400);
  }

  const csrfToken = await generateCsrfToken();

  return c.html(renderAuthorizePage({
    clientId,
    clientName: client.client_name,
    redirectUri,
    state: state ?? "",
    codeChallenge: codeChallenge ?? "",
    scope: scope ?? "mcp:tools",
    csrfToken,
  }));
});

auth.post("/authorize", async (c) => {
  const form = await c.req.parseBody();
  const email = form["email"] as string;
  const password = form["password"] as string;
  const clientId = form["client_id"] as string;
  const redirectUri = form["redirect_uri"] as string;
  const state = form["state"] as string;
  const codeChallenge = form["code_challenge"] as string;
  const scope = form["scope"] as string;
  const csrf = form["_csrf"] as string;

  if (!email || !password || !clientId || !redirectUri) {
    return c.html(renderAuthorizeError("Missing required fields"), 400);
  }

  // CSRF validation (stateless HMAC-signed tokens)
  if (!csrf || !(await verifyCsrfToken(csrf))) {
    return c.html(renderAuthorizeError("Invalid or expired form. Please try again."), 403);
  }

  const mgmtDb = await getManagementDb();

  // Re-validate client_id + redirect_uri from form body (prevents tampering with hidden fields)
  const authorizeStore = new ClientsStore(mgmtDb);
  const authorizeClient = await authorizeStore.getClient(clientId);
  if (!authorizeClient || !authorizeClient.redirect_uris.includes(redirectUri)) {
    return c.html(renderAuthorizeError("Invalid client or redirect URI"), 400);
  }

  // Login rate limiting (per email)
  const attemptKey = email.toLowerCase();
  const attempts = loginAttempts.get(attemptKey);
  if (attempts && attempts.count >= LOGIN_MAX_ATTEMPTS && Date.now() - attempts.windowStart < LOGIN_WINDOW_MS) {
    const retryCsrf = await generateCsrfToken();
    return c.html(renderAuthorizePage({
      clientId,
      redirectUri,
      state: state ?? "",
      codeChallenge: codeChallenge ?? "",
      scope: scope ?? "mcp:tools",
      csrfToken: retryCsrf,
      error: "Too many failed attempts. Please try again in 15 minutes.",
    }));
  }

  // Authenticate
  const tenant = await authenticateTenant(mgmtDb, email, password);
  if (!tenant) {
    const now = Date.now();
    const current = loginAttempts.get(attemptKey);
    if (current && now - current.windowStart < LOGIN_WINDOW_MS) {
      loginAttempts.set(attemptKey, { count: current.count + 1, windowStart: current.windowStart });
    } else {
      loginAttempts.set(attemptKey, { count: 1, windowStart: now });
    }
    const failCsrf = await generateCsrfToken();
    return c.html(renderAuthorizePage({
      clientId,
      redirectUri,
      state: state ?? "",
      codeChallenge: codeChallenge ?? "",
      scope: scope ?? "mcp:tools",
      csrfToken: failCsrf,
      error: "Invalid email or password",
    }));
  }

  // Clear login attempts on success
  loginAttempts.delete(attemptKey);

  // Bind client to tenant
  const store = new ClientsStore(mgmtDb);
  await store.bindClientToTenant(clientId, tenant.id);

  // Create authorization code
  const scopes = scope ? scope.split(" ") : ["mcp:tools"];
  const code = await createAuthorizationCode(
    mgmtDb,
    clientId,
    tenant.id,
    redirectUri,
    codeChallenge || null,
    scopes
  );

  // Redirect back with code
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);

  return c.redirect(url.toString(), 302);
});

// ============================================================================
// Token Endpoint (RFC 6749 §3.2)
// ============================================================================

const TokenInput = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    client_id: z.string().min(1),
    client_secret: z.string().optional(),
    redirect_uri: z.string().optional(),
    code_verifier: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
    client_secret: z.string().optional(),
  }),
]);

auth.post("/token", async (c) => {
  // Accept both JSON and form-encoded
  let body: Record<string, unknown>;
  const contentType = c.req.header("Content-Type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    body = await c.req.parseBody() as Record<string, unknown>;
  } else {
    body = await c.req.json().catch(() => ({}));
  }

  const parsed = TokenInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", error_description: parsed.error.errors[0]?.message }, 400);
  }

  const mgmtDb = await getManagementDb();

  // Client authentication
  const clientStore = new ClientsStore(mgmtDb);
  const client = await clientStore.getClient(parsed.data.client_id);
  if (!client) return c.json({ error: "invalid_client" }, 401);

  // Require client_secret for confidential clients (those that have a secret registered)
  const clientHasSecret = await clientStore.hasClientSecret(parsed.data.client_id);
  if (clientHasSecret) {
    if (!parsed.data.client_secret) {
      return c.json({ error: "invalid_client", error_description: "client_secret required" }, 401);
    }
    const valid = await clientStore.verifyClientSecret(parsed.data.client_id, parsed.data.client_secret);
    if (!valid) return c.json({ error: "invalid_client" }, 401);
  }

  try {
    if (parsed.data.grant_type === "authorization_code") {
      const tokens = await exchangeAuthorizationCode(
        mgmtDb,
        parsed.data.client_id,
        parsed.data.code,
        parsed.data.code_verifier,
        parsed.data.redirect_uri
      );
      return c.json(tokens);
    }

    const tokens = await exchangeRefreshToken(
      mgmtDb,
      parsed.data.client_id,
      parsed.data.refresh_token
    );
    return c.json(tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token exchange failed";
    return c.json({ error: "invalid_grant", error_description: message }, 400);
  }
});

// ============================================================================
// Token Revocation (RFC 7009)
// ============================================================================

auth.post("/revoke", async (c) => {
  let body: Record<string, unknown>;
  const contentType = c.req.header("Content-Type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    body = await c.req.parseBody() as Record<string, unknown>;
  } else {
    body = await c.req.json().catch(() => ({}));
  }

  const token = body["token"] as string;
  if (!token) {
    return c.json({ error: "invalid_request", error_description: "Missing token parameter" }, 400);
  }

  const mgmtDb = await getManagementDb();
  await revokeToken(mgmtDb, token);

  // RFC 7009: always return 200 even if token was already invalid
  return c.json({});
});

export { auth as authRoutes };
