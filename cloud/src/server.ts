/**
 * Muninn Cloud — Hono Server Entry Point
 *
 * Mounts: MCP endpoint (authenticated), API routes, OAuth endpoints, health check.
 */

import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { structuredLogger, logError } from "./lib/logger";
import { getManagementDb } from "./db/management";
import { setManagementDb, getPoolStats } from "./tenants/pool";
import { verifyAccessToken, AuthError } from "./auth/verifier";
import { handleMcpRequest, getSessionCount } from "./mcp-endpoint";
import { api } from "./api/routes";
import { authRoutes } from "./auth/routes";
import { corsMiddleware } from "./api/middleware";
import { PersistentRateLimiter, rateLimiter } from "./api/rate-limit";
import { metricsMiddleware, formatMetrics, dbPoolSize, activeMcpSessions } from "./lib/metrics";
import { generateRequestId } from "./lib/errors";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

type AppEnv = {
  Variables: {
    authInfo: AuthInfo;
    tenantId: string;
    requestId: string;
    plan?: string;
  };
};

const app = new Hono<AppEnv>();

const startTime = Date.now();
const limiter = new PersistentRateLimiter();

// ============================================================================
// Global Middleware
// ============================================================================

// Request ID propagation
app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? generateRequestId();
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-Id", requestId);
});

app.use("*", structuredLogger());
app.use("*", metricsMiddleware());
app.use("*", corsMiddleware());
app.use("*", secureHeaders({
  strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
  xContentTypeOptions: "nosniff",
  xFrameOptions: "DENY",
}));

// ============================================================================
// Health Check (with dependency verification)
// ============================================================================

app.get("/health", async (c) => {
  const checks: Record<string, unknown> = {};
  let healthy = true;

  // Management DB
  try {
    const mgmtDb = await getManagementDb();
    await mgmtDb.get("SELECT 1");
    checks.managementDb = "ok";
  } catch {
    checks.managementDb = "error";
    healthy = false;
  }

  // Pool stats
  const pool = getPoolStats();
  checks.pool = pool;

  // MCP sessions
  const sessionCount = getSessionCount();
  checks.mcpSessions = sessionCount;

  // Rate limiter
  checks.rateLimiter = limiter.getStats();

  // Update gauges
  dbPoolSize.setDirect(pool.size);
  activeMcpSessions.setDirect(sessionCount);

  const status = healthy ? "ok" : "degraded";
  const statusCode = healthy ? 200 : 503;

  return c.json({
    status,
    version: "0.1.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  }, statusCode);
});

app.get("/ready", async (c) => {
  try {
    const mgmtDb = await getManagementDb();
    await mgmtDb.get("SELECT 1");
    return c.json({ ready: true });
  } catch {
    return c.json({ ready: false }, 503);
  }
});

// ============================================================================
// Metrics Endpoint
// ============================================================================

app.get("/metrics", (c) => {
  // Restrict to local/Docker-internal networks or bearer token
  const metricsToken = process.env.METRICS_TOKEN;
  const ip = c.req.header("X-Real-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "";
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "" || ip.startsWith("172.") || ip.startsWith("10.");
  const hasToken = metricsToken && c.req.header("Authorization") === `Bearer ${metricsToken}`;

  if (!isLocal && !hasToken) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Update gauges before serving
  const pool = getPoolStats();
  dbPoolSize.setDirect(pool.size);
  activeMcpSessions.setDirect(getSessionCount());

  c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return c.text(formatMetrics());
});

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
app.use("/mcp", rateLimiter(limiter));

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
    logError("stripe-webhook", error);
    return c.json({ error: "Webhook processing failed" }, 400);
  }
});

// ============================================================================
// OAuth Routes
// ============================================================================

app.route("/auth", authRoutes);

// SSO Routes (SAML ACS + metadata, no auth required)
import { ssoRoutes } from "./sso/routes";
app.route("/auth/sso", ssoRoutes);

// ============================================================================
// API Routes
// ============================================================================

app.route("/api", api);

// ============================================================================
// Start Server
// ============================================================================

const PORT = Number(process.env.PORT) || 3000;

let server: ReturnType<typeof Bun.serve> | null = null;

async function start(): Promise<void> {
  console.log("[muninn-cloud] Initializing management database...");
  const mgmtDb = await getManagementDb();
  setManagementDb(mgmtDb);
  console.log("[muninn-cloud] Management database ready");

  // Start persistent rate limiter sync
  limiter.startSync(mgmtDb);
  console.log("[muninn-cloud] Rate limiter sync started");

  console.log(`[muninn-cloud] Starting server on port ${PORT}...`);

  server = Bun.serve({
    port: PORT,
    fetch: app.fetch,
    idleTimeout: 120,
  });

  console.log(`[muninn-cloud] Server running at http://localhost:${PORT}`);
  console.log(`[muninn-cloud] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`[muninn-cloud] API endpoint: http://localhost:${PORT}/api`);
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[muninn-cloud] ${signal} received, shutting down gracefully...`);

  // Stop accepting new connections
  if (server) {
    server.stop(true); // close idle connections immediately
  }

  // Flush rate limiter state
  await limiter.stopSync();

  // Close all MCP sessions
  const { closeAllSessions } = await import("./mcp-endpoint");
  await closeAllSessions();

  // Give in-flight requests 5s to drain
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("[muninn-cloud] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

start().catch((error) => {
  logError("startup", error);
  process.exit(1);
});
