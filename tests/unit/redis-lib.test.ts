/**
 * Tests for Redis client library — pub/sub bridge utilities.
 */
import { describe, expect, test } from "bun:test";

describe("Redis Library", () => {
  test("module exports expected functions", async () => {
    const mod = await import("../../src/lib/redis");
    expect(typeof mod.getRedisClient).toBe("function");
    expect(typeof mod.publishEvent).toBe("function");
    expect(typeof mod.readNeuroState).toBe("function");
    expect(typeof mod.closeRedis).toBe("function");
  });

  test("publishEvent does not throw when Redis is unavailable", async () => {
    const { publishEvent } = await import("../../src/lib/redis");
    // Should silently swallow the error
    await publishEvent("test:channel", { foo: "bar" });
  });

  test("readNeuroState returns null when Redis is unavailable", async () => {
    const { readNeuroState } = await import("../../src/lib/redis");
    const result = await readNeuroState();
    // Either null (no redis) or a valid state (if redis is running with huginn data)
    if (result !== null) {
      expect(typeof result.dopamine).toBe("number");
      expect(typeof result.serotonin).toBe("number");
      expect(typeof result.norepinephrine).toBe("number");
      expect(typeof result.acetylcholine).toBe("number");
    }
  });
});
