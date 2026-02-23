/**
 * API Middleware
 *
 * Bearer auth extraction, rate limiting, CORS, request logging.
 */

import { cors } from "hono/cors";
import type { Context } from "hono";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { verifyAccessToken, AuthError } from "../auth/verifier";
import { getManagementDb } from "../db/management";
import { isOverLimit } from "../billing/metering";

// Extend Hono context with auth info
export type AuthedEnv = {
  Variables: {
    auth: AuthInfo;
    tenantId: string;
  };
};

/**
 * CORS middleware configured from environment.
 * Defaults to muninn.pro; reads CORS_ORIGINS env var for additional origins.
 * Auto-adds localhost in development.
 */
export function corsMiddleware() {
  const defaults = ["https://muninn.pro", "https://api.muninn.pro"];
  const envOrigins = process.env.CORS_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];
  const origins = [...new Set([...defaults, ...envOrigins])];

  if (process.env.NODE_ENV === "development") {
    origins.push("http://localhost:3000", "http://localhost:5173");
  }

  return cors({
    origin: origins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "X-Request-Id"],
    exposeHeaders: ["Mcp-Session-Id", "X-Request-Id"],
    maxAge: 86400,
  });
}

/**
 * Bearer auth middleware - extracts and verifies token from Authorization header.
 */
export function bearerAuth() {
  return async (c: Context<AuthedEnv>, next: () => Promise<void>) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);
    try {
      const mgmtDb = await getManagementDb();
      const authInfo = await verifyAccessToken(mgmtDb, token);
      c.set("auth", authInfo);
      c.set("tenantId", authInfo.clientId);
    } catch (error) {
      if (error instanceof AuthError) {
        return c.json({ error: error.message }, error.statusCode as 401);
      }
      return c.json({ error: "Authentication failed" }, 401);
    }
    return next();
  };
}

/**
 * Plan limit enforcement middleware.
 */
export function planLimits() {
  return async (c: Context<AuthedEnv>, next: () => Promise<void>): Promise<Response | void> => {
    const tenantId = c.get("tenantId") as string;
    if (!tenantId) return next();

    const overLimit = await isOverLimit(tenantId);
    if (overLimit) {
      return c.json(
        { error: "Plan limit exceeded. Upgrade at https://muninn.pro/pricing" },
        429
      );
    }

    await next();
  };
}
