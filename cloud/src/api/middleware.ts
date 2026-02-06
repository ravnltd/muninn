/**
 * API Middleware
 *
 * Bearer auth extraction, rate limiting, CORS, request logging.
 */

import { cors } from "hono/cors";
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
 * CORS middleware configured for API usage.
 */
export function corsMiddleware() {
  return cors({
    origin: ["https://muninn.pro", "https://api.muninn.pro"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
    exposeHeaders: ["Mcp-Session-Id"],
    maxAge: 86400,
  });
}

/**
 * Bearer auth middleware - extracts and verifies token from Authorization header.
 */
export function bearerAuth() {
  return async (c: any, next: () => Promise<void>) => {
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
      await next();
    } catch (error) {
      if (error instanceof AuthError) {
        return c.json({ error: error.message }, error.statusCode);
      }
      return c.json({ error: "Authentication failed" }, 401);
    }
  };
}

/**
 * Plan limit enforcement middleware.
 */
export function planLimits() {
  return async (c: any, next: () => Promise<void>) => {
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
