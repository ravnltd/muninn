/**
 * Muninn Cloud — Hono Server Entry Point
 *
 * Mounts: MCP endpoint (authenticated), API routes, OAuth endpoints, health check.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { getManagementDb } from "./db/management";
import { setManagementDb } from "./tenants/pool";
import { verifyAccessToken, AuthError } from "./auth/verifier";
import { handleMcpRequest } from "./mcp-endpoint";
import { api } from "./api/routes";
import { corsMiddleware } from "./api/middleware";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

const app = new Hono();

// ============================================================================
// Global Middleware
// ============================================================================

app.use("*", logger());
app.use("*", corsMiddleware());

// ============================================================================
// Health Check
// ============================================================================

app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// ============================================================================
// MCP Endpoint (Bearer auth + plan limits)
// ============================================================================

app.all("/mcp", async (c) => {
  // Extract bearer token
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing Authorization header. Use: --header 'Authorization: Bearer mk_xxx'" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  let authInfo: AuthInfo;

  try {
    const mgmtDb = await getManagementDb();
    authInfo = await verifyAccessToken(mgmtDb, token);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    return Response.json({ error: "Authentication failed" }, { status: 401 });
  }

  // Check plan limits before processing
  const { isOverLimit } = await import("./billing/metering");
  if (await isOverLimit(authInfo.clientId)) {
    return Response.json(
      { error: "Plan limit exceeded. Upgrade at https://muninn.pro/pricing" },
      { status: 429 }
    );
  }

  // Handle DELETE for session termination
  if (c.req.method === "DELETE") {
    // Session cleanup is handled by the transport
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
  console.error("[muninn-cloud] Fatal error:", error);
  process.exit(1);
});
