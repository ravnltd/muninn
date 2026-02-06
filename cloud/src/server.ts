/**
 * Muninn Cloud — Hono Server Entry Point
 *
 * Mounts: MCP endpoint (authenticated), API routes, OAuth endpoints, health check.
 */

import { Hono } from "hono";
import { structuredLogger, logError } from "./lib/logger";
import { getManagementDb } from "./db/management";
import { setManagementDb } from "./tenants/pool";
import { verifyAccessToken, AuthError } from "./auth/verifier";
import { handleMcpRequest } from "./mcp-endpoint";
import { api } from "./api/routes";
import { authRoutes } from "./auth/routes";
import { corsMiddleware } from "./api/middleware";
import { rateLimiter } from "./api/rate-limit";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

type AppEnv = {
  Variables: {
    authInfo: AuthInfo;
    tenantId: string;
    plan?: string;
  };
};

const app = new Hono<AppEnv>();

// ============================================================================
// Global Middleware
// ============================================================================

app.use("*", structuredLogger());
app.use("*", corsMiddleware());

// ============================================================================
// Health Check
// ============================================================================

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// ============================================================================
// MCP Endpoint (auth → rate limit → plan limits → handler)
// ============================================================================

// Auth middleware for /mcp — sets tenantId + plan on context
app.use("/mcp", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      { error: "Missing Authorization header. Use: --header 'Authorization: Bearer mk_xxx'" },
      401
    );
  }

  const token = authHeader.slice(7);
  try {
    const mgmtDb = await getManagementDb();
    const authInfo = await verifyAccessToken(mgmtDb, token);
    c.set("authInfo", authInfo);
    c.set("tenantId", authInfo.clientId);
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json({ error: error.message }, error.statusCode as 401);
    }
    return c.json({ error: "Authentication failed" }, 401);
  }

  return next();
});

// Rate limit by tenantId (set by auth middleware above)
app.use("/mcp", rateLimiter());

app.all("/mcp", async (c) => {
  const authInfo = c.get("authInfo") as AuthInfo;

  // Check plan limits before processing
  const { isOverLimit } = await import("./billing/metering");
  if (await isOverLimit(authInfo.clientId)) {
    return c.json(
      { error: "Plan limit exceeded. Upgrade at https://muninn.pro/pricing" },
      429
    );
  }

  // Handle DELETE for session termination
  if (c.req.method === "DELETE") {
    return new Response(null, { status: 204 });
  }

  // Route to MCP handler
  return handleMcpRequest(c.req.raw, authInfo);
});

// ============================================================================
// OAuth Discovery Endpoints (RFC 8414 / RFC 9728)
// ============================================================================

const BASE_URL = process.env.BASE_URL || "https://api.muninn.pro";

app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/auth/authorize`,
    token_endpoint: `${BASE_URL}/auth/token`,
    registration_endpoint: `${BASE_URL}/auth/register`,
    revocation_endpoint: `${BASE_URL}/auth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: ["mcp:tools"],
    service_documentation: "https://muninn.pro/docs",
  });
});

app.get("/.well-known/oauth-protected-resource/*", (c) => {
  return c.json({
    resource: `${BASE_URL}/mcp`,
    authorization_servers: [BASE_URL],
    scopes_supported: ["mcp:tools"],
    bearer_methods_supported: ["header"],
    resource_name: "Muninn Memory System",
    resource_documentation: "https://muninn.pro/docs",
  });
});

// ============================================================================
// Stripe Webhook (raw body — must be before JSON parsing)
// ============================================================================

app.post("/webhooks/stripe", async (c) => {
  const signature = c.req.header("Stripe-Signature");
  if (!signature) return c.json({ error: "Missing Stripe-Signature" }, 400);

  try {
    const rawBody = await c.req.text();
    const { handleStripeWebhook } = await import("./billing/stripe");
    const mgmtDb = await getManagementDb();
    await handleStripeWebhook(mgmtDb, rawBody, signature);
    return c.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook failed";
    logError("stripe-webhook", error);
    return c.json({ error: message }, 400);
  }
});

// ============================================================================
// OAuth Routes
// ============================================================================

app.route("/auth", authRoutes);

// ============================================================================
// API Routes
// ============================================================================

app.route("/api", api);

// ============================================================================
// Start Server
// ============================================================================

const PORT = Number(process.env.PORT) || 3000;

async function start(): Promise<void> {
  console.log("[muninn-cloud] Initializing management database...");
  const mgmtDb = await getManagementDb();
  setManagementDb(mgmtDb);
  console.log("[muninn-cloud] Management database ready");

  console.log(`[muninn-cloud] Starting server on port ${PORT}...`);

  Bun.serve({
    port: PORT,
    fetch: app.fetch,
    idleTimeout: 120,
  });

  console.log(`[muninn-cloud] Server running at http://localhost:${PORT}`);
  console.log(`[muninn-cloud] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`[muninn-cloud] API endpoint: http://localhost:${PORT}/api`);
}

start().catch((error) => {
  logError("startup", error);
  process.exit(1);
});
