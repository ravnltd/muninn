/**
 * Persistent Per-Tenant Rate Limiting
 *
 * Write-behind cache: hot path stays in-memory (<1ms),
 * background sync to DB every 10s for cross-instance persistence.
 *
 * Request -> in-memory consume() -> response  [<1ms, every request]
 *               |
 *       Background sync  [every 10s]
 *               |
 *       Batch upsert + read cross-instance -> merge min(tokens)
 */

import type { Context, Next } from "hono";
import type { DatabaseAdapter } from "../types";

interface Bucket {
  tokens: number;
  lastRefill: number;
  dirty: boolean;
}

interface ViolationRecord {
  tenantId: string;
  key: string;
  plan: string;
  limit: number;
  ip: string | null;
}

const PLAN_RATES: Record<string, number> = {
  free: 60,
  pro: 300,
  team: 1000,
};

export interface RateLimiterStats {
  bucketCount: number;
  syncEnabled: boolean;
  lastSyncAt: number | null;
  syncErrors: number;
}

export class PersistentRateLimiter {
  private buckets = new Map<string, Bucket>();
  private pendingViolations: ViolationRecord[] = [];
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private db: DatabaseAdapter | null = null;
  private instanceId: string;
  private lastSyncAt: number | null = null;
  private syncErrors = 0;

  constructor(private readonly syncIntervalMs = 10_000) {
    this.instanceId = crypto.randomUUID().slice(0, 8);
  }

  /**
   * Consume a token from the bucket (synchronous, in-memory).
   * Returns { allowed, remaining, retryAfter }.
   */
  consume(key: string, plan: string): { allowed: boolean; remaining: number; limit: number; retryAfter?: number } {
    const limit = PLAN_RATES[plan] ?? PLAN_RATES.free;
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now, dirty: false };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    const refillRate = limit / 60;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate);
      return { allowed: false, remaining: 0, limit, retryAfter };
    }

    bucket.tokens -= 1;
    bucket.dirty = true;
    return { allowed: true, remaining: Math.floor(bucket.tokens), limit };
  }

  /**
   * Log a rate limit violation for later persistence.
   */
  logViolation(tenantId: string, key: string, plan: string, limit: number, ip: string | null): void {
    this.pendingViolations.push({ tenantId, key, plan, limit, ip });
  }

  /**
   * Start background sync to DB.
   */
  startSync(db: DatabaseAdapter): void {
    this.db = db;

    // Ensure tables exist
    this.ensureTables().catch(() => {});

    this.syncTimer = setInterval(() => {
      this.sync().catch(() => {
        this.syncErrors++;
      });
    }, this.syncIntervalMs);
    if (typeof this.syncTimer === "object" && "unref" in this.syncTimer) {
      this.syncTimer.unref();
    }

    // Cleanup stale buckets every 10 minutes
    this.cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [key, bucket] of this.buckets) {
        if (bucket.lastRefill < cutoff) this.buckets.delete(key);
      }
    }, 10 * 60 * 1000);
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop sync and flush final state.
   */
  async stopSync(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Final flush
    if (this.db) {
      await this.sync().catch(() => {});
    }
  }

  /**
   * Get stats for health check.
   */
  getStats(): RateLimiterStats {
    return {
      bucketCount: this.buckets.size,
      syncEnabled: this.db !== null,
      lastSyncAt: this.lastSyncAt,
      syncErrors: this.syncErrors,
    };
  }

  private async ensureTables(): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS rate_limit_state (
          key TEXT NOT NULL,
          instance_id TEXT NOT NULL,
          tokens REAL NOT NULL,
          last_refill_ms INTEGER NOT NULL,
          plan TEXT NOT NULL DEFAULT 'free',
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (key, instance_id)
        );
        CREATE TABLE IF NOT EXISTS rate_limit_violations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL,
          key TEXT NOT NULL,
          plan TEXT NOT NULL,
          limit_value INTEGER NOT NULL,
          ip_address TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch {
      // Non-fatal — degrade to in-memory only
    }
  }

  private async sync(): Promise<void> {
    if (!this.db) return;

    const db = this.db;

    // 1. Upsert dirty buckets
    const dirtyEntries: Array<{ key: string; bucket: Bucket }> = [];
    for (const [key, bucket] of this.buckets) {
      if (bucket.dirty) {
        dirtyEntries.push({ key, bucket });
        bucket.dirty = false;
      }
    }

    if (dirtyEntries.length > 0) {
      try {
        const batch = dirtyEntries.map(({ key, bucket }) => ({
          sql: `INSERT INTO rate_limit_state (key, instance_id, tokens, last_refill_ms, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(key, instance_id)
                DO UPDATE SET tokens = excluded.tokens, last_refill_ms = excluded.last_refill_ms, updated_at = excluded.updated_at`,
          params: [key, this.instanceId, bucket.tokens, bucket.lastRefill, Date.now()] as unknown[],
        }));
        await db.batch(batch);
      } catch {
        // Mark as dirty again so we retry
        for (const { key } of dirtyEntries) {
          const b = this.buckets.get(key);
          if (b) b.dirty = true;
        }
      }
    }

    // 2. Read cross-instance state and merge (conservative — take minimum tokens)
    try {
      const crossInstance = await db.all<{
        key: string;
        min_tokens: number;
        last_refill_ms: number;
      }>(
        `SELECT key, MIN(tokens) as min_tokens, MAX(last_refill_ms) as last_refill_ms
         FROM rate_limit_state
         WHERE instance_id != ? AND updated_at > ?
         GROUP BY key`,
        [this.instanceId, Date.now() - 2 * this.syncIntervalMs]
      );

      for (const row of crossInstance) {
        const bucket = this.buckets.get(row.key);
        if (bucket && row.min_tokens < bucket.tokens) {
          bucket.tokens = row.min_tokens;
        }
      }
    } catch {
      // Non-fatal — continue with local state
    }

    // 3. Flush pending violations
    if (this.pendingViolations.length > 0) {
      const violations = this.pendingViolations.splice(0);
      try {
        const batch = violations.map((v) => ({
          sql: `INSERT INTO rate_limit_violations (tenant_id, key, plan, limit_value, ip_address) VALUES (?, ?, ?, ?, ?)`,
          params: [v.tenantId, v.key, v.plan, v.limit, v.ip] as unknown[],
        }));
        await db.batch(batch);
      } catch {
        // Non-fatal — violations are informational
      }
    }

    this.lastSyncAt = Date.now();
  }
}

/**
 * Rate limit middleware factory.
 * Uses PersistentRateLimiter instance for cross-instance aware limiting.
 */
export function rateLimiter(limiter?: PersistentRateLimiter) {
  // Fallback to in-memory-only limiter if none provided
  const rl = limiter ?? new PersistentRateLimiter();

  return async (c: Context, next: Next) => {
    const tenantId = c.get("tenantId") as string | undefined;
    const key = tenantId ?? c.req.header("X-Real-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
    const plan = (c.get("plan") as string | undefined) ?? "free";

    const result = rl.consume(key, plan);

    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfter ?? 1));
      c.header("X-RateLimit-Limit", String(result.limit));
      c.header("X-RateLimit-Remaining", "0");

      // Log violation
      const ip = c.req.header("X-Real-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? null;
      rl.logViolation(tenantId ?? "unknown", key, plan, result.limit, ip);

      return c.json({ error: "Rate limit exceeded", retryAfter: result.retryAfter }, 429);
    }

    c.header("X-RateLimit-Limit", String(result.limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));

    return next();
  };
}
