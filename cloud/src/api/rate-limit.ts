/**
 * Per-Tenant Rate Limiting
 *
 * In-memory token bucket per tenant, keyed by tenantId from auth.
 * Limits scale with plan tier.
 */

import type { Context, Next } from "hono";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const PLAN_RATES: Record<string, number> = {
  free: 60,
  pro: 300,
  team: 1000,
};

const buckets = new Map<string, Bucket>();

// Clean up stale buckets every 10 minutes
// .unref() via safeInterval prevents this from keeping the process alive
const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefill < cutoff) buckets.delete(key);
  }
}, 10 * 60 * 1000);
if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) cleanupTimer.unref();

/**
 * Rate limit middleware. Extracts tenantId from context (set by auth middleware).
 * Falls back to IP-based limiting for unauthenticated requests.
 */
export function rateLimiter() {
  return async (c: Context, next: Next) => {
    const tenantId = c.get("tenantId") as string | undefined;
    const key = tenantId ?? c.req.header("X-Forwarded-For") ?? "unknown";
    const plan = (c.get("plan") as string | undefined) ?? "free";
    const limit = PLAN_RATES[plan] ?? PLAN_RATES.free;

    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time (1 token per 60s/limit interval)
    const elapsed = (now - bucket.lastRefill) / 1000;
    const refillRate = limit / 60; // tokens per second
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
