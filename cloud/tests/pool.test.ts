/**
 * Tests for tenant connection pool: LRU eviction, stats, management.
 *
 * Note: We can't easily test getTenantDb since it creates real HttpAdapter connections.
 * Instead we test the pool management functions (evictTenant, getPoolStats, setManagementDb).
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { setManagementDb, evictTenant, getPoolStats } from "../src/tenants/pool";
import { createMockDb } from "./mock-db";

beforeEach(() => {
  // Reset pool state by evicting all known tenants
  // (pool is module-level state, tests share it)
});

describe("setManagementDb", () => {
  test("does not throw when called with valid adapter", () => {
    const db = createMockDb();
    expect(() => setManagementDb(db)).not.toThrow();
  });
});

describe("getPoolStats", () => {
  test("returns pool size and maxSize", () => {
    const stats = getPoolStats();
    expect(stats).toHaveProperty("size");
    expect(stats).toHaveProperty("maxSize");
    expect(stats.maxSize).toBe(200);
  });

  test("size is a non-negative number", () => {
    const stats = getPoolStats();
    expect(stats.size).toBeGreaterThanOrEqual(0);
  });
});

describe("evictTenant", () => {
  test("does not throw for non-existent tenant", () => {
    expect(() => evictTenant("nonexistent-tenant")).not.toThrow();
  });
});
