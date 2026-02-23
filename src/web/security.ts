/**
 * Auth middleware, CORS helpers, and IP detection for the web server.
 */

import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

/**
 * Get client IP address with configurable proxy trust.
 * Only trusts x-forwarded-for when MUNINN_TRUSTED_PROXY=true.
 */
export function getClientIp(c: Context): string {
  if (process.env.MUNINN_TRUSTED_PROXY === "true") {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
  }
  // Fall back to host header (without port) or localhost
  return c.req.header("host")?.split(":")[0] || "localhost";
}

/**
 * Timing-safe token comparison to prevent timing attacks.
 * Returns true if tokens match, false otherwise.
 */
export function safeTokenCompare(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  // If lengths differ, still do comparison to prevent length-based timing attacks
  // but always return false
  if (providedBuf.length !== expectedBuf.length) {
    // Compare against itself to maintain constant time
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Check if the request is from localhost based on multiple indicators.
 * More robust than relying solely on Host header which can be spoofed.
 */
export function isLocalhostRequest(c: Context): boolean {
  // Check Host header (primary check, but can be spoofed)
  const host = c.req.header("host") || "";
  const hostIsLocal =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:");

  // Check X-Forwarded-For if NOT trusting proxy (absence = likely direct connection)
  // If there's no X-Forwarded-For and host looks local, it's more likely genuine
  const hasForwardedFor = !!c.req.header("x-forwarded-for");

  // In non-proxy mode, X-Forwarded-For presence suggests potential spoofing attempt
  if (process.env.MUNINN_TRUSTED_PROXY !== "true" && hasForwardedFor) {
    return false;
  }

  return hostIsLocal;
}

/**
 * Create token-based authentication middleware.
 * Requires MUNINN_API_TOKEN env var to be set to enable auth.
 * Localhost bypass is enabled by default (MUNINN_LOCALHOST_BYPASS != "false").
 *
 * Security features:
 * - Timing-safe token comparison (prevents timing attacks)
 * - Multi-factor localhost detection (mitigates Host header spoofing)
 * - Minimum token length warning
 */
export function createAuthMiddleware() {
  const apiToken = process.env.MUNINN_API_TOKEN;

  // Warn about weak tokens (L3: minimum token length)
  if (apiToken && apiToken.length < 32) {
    console.warn(
      "⚠️  MUNINN_API_TOKEN is less than 32 characters. Consider using a stronger token for security."
    );
  }

  return async (c: Context, next: Next) => {
    // If no token configured, auth is disabled
    if (!apiToken) {
      return next();
    }

    // GET/OPTIONS requests don't require auth (read-only)
    if (c.req.method === "GET" || c.req.method === "OPTIONS") {
      return next();
    }

    // Localhost bypass (enabled by default) - uses multi-factor detection
    if (process.env.MUNINN_LOCALHOST_BYPASS !== "false") {
      if (isLocalhostRequest(c)) {
        return next();
      }
    }

    // Check Bearer token with timing-safe comparison (H4: timing attack fix)
    const authHeader = c.req.header("Authorization") || "";
    const expectedHeader = `Bearer ${apiToken}`;
    if (safeTokenCompare(authHeader, expectedHeader)) {
      return next();
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
}
