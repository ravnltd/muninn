/**
 * Per-Tenant Rate Limiting
 *
 * In-memory token bucket per tenant.
 * Default: 300 requests/minute.
 */

import type { Context, Next } from "hono";
import type { ApiEnv } from "../types";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_RATE = 300; // requests per minute
const buckets = new Map<string, Bucket>();

// Clean up stale buckets every 10 minutes
const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefill < cutoff) buckets.delete(key);
  }
}, 10 * 60 * 1000);
if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
  cleanupTimer.unref();
}

export function rateLimiter(limit: number = DEFAULT_RATE) {
  return async (c: Context<ApiEnv>, next: Next) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) {
      return c.json({ error: "Internal server error" }, 500);
    }

    const now = Date.now();
    let bucket = buckets.get(tenantId);

    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      buckets.set(tenantId, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    const refillRate = limit / 60;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate);
      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", "0");
      return c.json({ error: "Rate limit exceeded", retryAfter }, 429);
    }

    bucket.tokens -= 1;
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(Math.floor(bucket.tokens)));

    return next();
  };
}
