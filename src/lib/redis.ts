/**
 * Redis client for Muninn — used for pub/sub bridge with Huginn.
 *
 * Lazy singleton. Non-critical: if Redis is down, Muninn works fine
 * without it (just no real-time Huginn integration).
 */

import Redis from "ioredis";

let client: Redis | null = null;
let available = false;

const REDIS_URL = process.env.MUNINN_REDIS_URL || "redis://127.0.0.1:6379/0";
const CONNECT_TIMEOUT = 3000;

/**
 * Get or create the Redis client singleton.
 * Returns null if Redis is unavailable.
 */
export function getRedisClient(): Redis | null {
  if (client && available) return client;

  if (client) return null; // Already tried, failed

  try {
    client = new Redis(REDIS_URL, {
      connectTimeout: CONNECT_TIMEOUT,
      maxRetriesPerRequest: 1,
      retryStrategy(times: number) {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    client.on("connect", () => {
      available = true;
    });

    client.on("error", () => {
      available = false;
    });

    client.on("close", () => {
      available = false;
    });

    // Non-blocking connect attempt
    client.connect().catch(() => {
      available = false;
    });

    return client;
  } catch {
    return null;
  }
}

/**
 * Publish an event to a Redis channel.
 * Fire-and-forget — never throws, never blocks critical paths.
 */
export async function publishEvent(
  channel: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !available) return;

  try {
    await redis.publish(channel, JSON.stringify(payload));
  } catch {
    // Non-critical — Huginn will still work without real-time events
  }
}

/**
 * Read Huginn's current neuro state from Redis.
 * Returns null if unavailable or no neuro state stored.
 */
export async function readNeuroState(): Promise<Record<string, number> | null> {
  const redis = getRedisClient();
  if (!redis || !available) return null;

  try {
    const keys = ["dopamine", "serotonin", "norepinephrine", "acetylcholine"] as const;
    const result: Record<string, number> = {};

    for (const key of keys) {
      const data = await redis.hget(`huginn:neuro:${key}`, "value");
      if (data !== null) {
        result[key] = parseFloat(data);
      }
    }

    return Object.keys(result).length === 4 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Clean shutdown of Redis client.
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
    client = null;
    available = false;
  }
}
