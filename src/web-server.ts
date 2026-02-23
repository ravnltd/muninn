/**
 * Muninn Dashboard Server
 * Hono-based API serving project data + static dashboard assets
 *
 * Uses DatabaseAdapter for HTTP/local mode support.
 * In HTTP mode, queries go to the remote sqld server.
 * In local mode, queries use bun:sqlite via LocalAdapter.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";
import type { DatabaseAdapter } from "./database/adapter";
import { getGlobalDb as getGlobalDbAdapter } from "./database/connection";
import { SafePort } from "./mcp-validation.js";
import { getClientIp, createAuthMiddleware } from "./web/security";
import { registerReadRoutes } from "./web/routes/read";
import { registerWriteRoutes } from "./web/routes/write";

// ============================================================================
// App Setup
// ============================================================================

/**
 * Create the dashboard Hono app.
 * Accepts an optional DatabaseAdapter for testing/DI.
 * When not provided, uses getGlobalDbAdapter() which auto-detects HTTP/local mode.
 */
export function createApp(adapter?: DatabaseAdapter): Hono {
  const app = new Hono();

  // Lazy-init: resolved on first API request
  let dbAdapter: DatabaseAdapter | null = adapter ?? null;

  async function getDb(): Promise<DatabaseAdapter> {
    if (!dbAdapter) {
      dbAdapter = await getGlobalDbAdapter();
    }
    return dbAdapter;
  }

  // Look up project and return its project_id.
  // In HTTP mode all projects share one DB, so we just verify the project exists.
  async function resolveProject(
    projectId: number,
  ): Promise<{ adapter: DatabaseAdapter; project: Record<string, unknown>; localProjectId: number } | null> {
    const db = await getDb();
    try {
      const project = await db.get<Record<string, unknown>>(
        "SELECT * FROM projects WHERE id = ?",
        [projectId],
      );
      if (!project) return null;
      return { adapter: db, project, localProjectId: projectId };
    } catch (e) {
      console.error("resolveProject error:", e);
      return null;
    }
  }

  // Security headers
  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    })
  );

  // CORS: Allow localhost and Tailscale reverse-proxy origins
  app.use(
    "/*",
    cors({
      origin: (origin) => {
        // Allow same-origin requests (no Origin header)
        if (!origin) return "*";
        // Allow localhost/127.0.0.1/[::1] (IPv4 and IPv6)
        const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
        if (localhostPattern.test(origin)) return origin;
        // Allow Tailscale IPs and internal domains (Caddy reverse proxy)
        const tailscalePattern = /^https?:\/\/(100\.64\.\d+\.\d+|10\.0\.55\.\d+|[a-z0-9.-]+\.xn--rven-qoa\.com)(:\d+)?$/;
        if (tailscalePattern.test(origin)) return origin;
        return "";
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    })
  );

  // Rate limiting for write endpoints (30 requests per minute)
  // Uses getClientIp which only trusts x-forwarded-for when MUNINN_TRUSTED_PROXY=true
  const writeRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: getClientIp,
    message: { error: "Too many write requests, please slow down" },
    standardHeaders: "draft-7",
  });

  // Rate limiting for read endpoints (200 requests per minute)
  const readRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 200,
    keyGenerator: getClientIp,
    message: { error: "Too many requests" },
    standardHeaders: "draft-7",
  });

  // Token-based authentication for write operations (H2: Token auth)
  // Set MUNINN_API_TOKEN env var to enable. Localhost bypassed by default.
  app.use("/api/*", createAuthMiddleware());

  // Apply rate limiting to API routes
  app.use("/api/*", readRateLimiter);

  // Register route handlers
  const deps = { getDb, resolveProject };
  registerReadRoutes(app, deps);
  registerWriteRoutes(app, deps, writeRateLimiter);

  return app;
}

// ============================================================================
// Startup Health Check
// ============================================================================

async function verifyStaticServing(port: number): Promise<void> {
  // Verify index.html serves with content
  const indexRes = await fetch(`http://localhost:${port}/`);
  const contentLength = indexRes.headers.get("content-length");

  if (contentLength === "0" || contentLength === null) {
    console.error(`FATAL: Static file serving broken - index.html has content-length: ${contentLength}`);
    console.error("This is the Hono+Bun bug. Check serveStaticFile() uses arrayBuffer().");
    process.exit(1);
  }

  // Verify body is not empty
  const body = await indexRes.text();
  if (body.length === 0) {
    console.error("FATAL: Static file serving broken - index.html body is empty");
    process.exit(1);
  }

  console.log(`Health check passed: index.html serves ${contentLength} bytes`);
}

// ============================================================================
// Standalone Entry
// ============================================================================

if (import.meta.main) {
  const portArg = process.argv[2] || "3334";
  const portResult = SafePort.safeParse(portArg);
  if (!portResult.success) {
    console.error(`Invalid port: ${portArg}. Must be 1-65535.`);
    process.exit(1);
  }
  const port = portResult.data;
  const app = createApp();

  Bun.serve({
    fetch: app.fetch,
    port,
  });

  console.log(`Muninn Dashboard: http://localhost:${port}`);

  // Run health check after server starts
  verifyStaticServing(port).catch((err) => {
    console.error("Health check failed:", err.message);
    process.exit(1);
  });
}

export default createApp;
