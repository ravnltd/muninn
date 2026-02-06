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
// Dynamic Client Registration (RFC 7591)
// ============================================================================

const RegisterInput = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().max(200).optional(),
  grant_types: z.array(z.string()).optional(),
});

auth.post("/register", async (c) => {
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

  return c.html(renderAuthorizePage({
    clientId,
    clientName: client.client_name,
    redirectUri,
    state: state ?? "",
    codeChallenge: codeChallenge ?? "",
    scope: scope ?? "mcp:tools",
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

  if (!email || !password || !clientId || !redirectUri) {
    return c.html(renderAuthorizeError("Missing required fields"), 400);
  }

  const mgmtDb = await getManagementDb();

  // Authenticate
  const tenant = await authenticateTenant(mgmtDb, email, password);
  if (!tenant) {
    return c.html(renderAuthorizePage({
      clientId,
      redirectUri,
      state: state ?? "",
      codeChallenge: codeChallenge ?? "",
      scope: scope ?? "mcp:tools",
      error: "Invalid email or password",
    }));
  }

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
    codeChallenge || "",
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

  try {
    if (parsed.data.grant_type === "authorization_code") {
      const tokens = await exchangeAuthorizationCode(
        mgmtDb,
        parsed.data.client_id,
        parsed.data.code,
        parsed.data.code_verifier
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
