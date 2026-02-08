/**
 * Muninn Memory API — Hono Server Entry Point
 *
 * Memory as a Service for Raven apps (Huginn, Studio, Claude Code).
 * Mounts: health, memory CRUD, search, context, app management.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ApiEnv } from "./types";
import { authMiddleware } from "./middleware/auth";
import { rateLimiter } from "./middleware/rate-limit";
import { health } from "./routes/health";
import { memories } from "./routes/memories";
import { search } from "./routes/search";
import { context } from "./routes/context";
import { apps } from "./routes/apps";
import { closeDb } from "./db/postgres";

const app = new Hono<ApiEnv>();

// ============================================================================
// Global Middleware
// ============================================================================

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Muninn-App"],
    maxAge: 86400,
  })
);

// ============================================================================
// Health (unauthenticated)
// ============================================================================

app.route("/v1", health);

// ============================================================================
// Authenticated Routes
// ============================================================================

// Auth + rate limiting for all /v1 routes (except health above)
app.use("/v1/memories/*", authMiddleware());
app.use("/v1/memories/*", rateLimiter());
app.use("/v1/apps/*", authMiddleware());
app.use("/v1/apps/*", rateLimiter());

// Search and Context must be mounted before CRUD to avoid /:id matching
app.route("/v1/memories/search", search);
app.route("/v1/memories/context", context);

// Memory CRUD (has /:id param route — must come after specific sub-routes)
app.route("/v1/memories", memories);

// App management
app.route("/v1/apps", apps);

// ============================================================================
// 404 Fallback
// ============================================================================

app.notFound((c) => {
  return c.json(
    {
      error: "Not found",
      hint: "Available endpoints: /v1/health, /v1/memories, /v1/memories/search, /v1/memories/context, /v1/apps",
    },
    404
  );
});

// ============================================================================
// Error Handler
// ============================================================================

app.onError((err, c) => {
  console.error("[api] Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// ============================================================================
// Start Server
// ============================================================================

const PORT = Number(process.env.PORT) || 3400;

console.log(`[muninn-api] Starting Memory API on port ${PORT}...`);

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 120,
});

console.log(`[muninn-api] Memory API running at http://localhost:${PORT}`);
console.log(`[muninn-api] Health: http://localhost:${PORT}/v1/health`);

// Graceful shutdown
const shutdown = async () => {
  console.log("[muninn-api] Shutting down...");
  server.stop();
  await closeDb();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app };
