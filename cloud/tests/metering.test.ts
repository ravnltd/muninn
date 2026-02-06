/**
 * Tests for usage metering and plan limits.
 *
 * These tests need to mock getManagementDb since metering
 * uses a module-level singleton.
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { createMockDb, seedTenant } from "./mock-db";
import type { DatabaseAdapter } from "../src/types";

let db: DatabaseAdapter;

// Mock getManagementDb to return our test DB
mock.module("../src/db/management", () => ({
  getManagementDb: async () => db,
}));

// Import after mocking
const { incrementToolCallCount, getUsage, isOverLimit } = await import("../src/billing/metering");

let tenantId: string;

beforeEach(async () => {
  db = createMockDb();
  const tenant = await seedTenant(db);
  tenantId = tenant.id;
});

describe("incrementToolCallCount", () => {
  test("creates usage record on first call", async () => {
    await incrementToolCallCount(tenantId);

    const usage = await db.get<{ tool_call_count: number }>(
      "SELECT tool_call_count FROM usage WHERE tenant_id = ?",
      [tenantId]
    );
    expect(usage!.tool_call_count).toBe(1);
  });

  test("increments on subsequent calls", async () => {
    await incrementToolCallCount(tenantId);
    await incrementToolCallCount(tenantId);
    await incrementToolCallCount(tenantId);

    const usage = await db.get<{ tool_call_count: number }>(
      "SELECT tool_call_count FROM usage WHERE tenant_id = ?",
      [tenantId]
    );
    expect(usage!.tool_call_count).toBe(3);
  });

  test("stores correct month", async () => {
    await incrementToolCallCount(tenantId);

    const expectedMonth = new Date().toISOString().slice(0, 7);
    const usage = await db.get<{ month: string }>(
      "SELECT month FROM usage WHERE tenant_id = ?",
      [tenantId]
    );
    expect(usage!.month).toBe(expectedMonth);
  });
});

describe("getUsage", () => {
  test("returns zero for new tenant", async () => {
    const usage = await getUsage(tenantId);
    expect(usage.toolCallCount).toBe(0);
    expect(usage.queryCount).toBe(0);
  });

  test("returns correct count after increments", async () => {
    await incrementToolCallCount(tenantId);
    await incrementToolCallCount(tenantId);

    const usage = await getUsage(tenantId);
    expect(usage.toolCallCount).toBe(2);
  });

  test("returns free plan limit by default", async () => {
    const usage = await getUsage(tenantId);
    expect(usage.plan).toBe("free");
    expect(usage.limit).toBe(10_000);
  });

  test("returns pro plan limit", async () => {
    await db.run("UPDATE tenants SET plan = 'pro' WHERE id = ?", [tenantId]);
    const usage = await getUsage(tenantId);
    expect(usage.plan).toBe("pro");
    expect(usage.limit).toBe(100_000);
  });

  test("returns team plan limit (Infinity)", async () => {
    await db.run("UPDATE tenants SET plan = 'team' WHERE id = ?", [tenantId]);
    const usage = await getUsage(tenantId);
    expect(usage.plan).toBe("team");
    expect(usage.limit).toBe(Infinity);
  });

  test("defaults to free limit for unknown plan", async () => {
    await db.run("UPDATE tenants SET plan = 'enterprise' WHERE id = ?", [tenantId]);
    const usage = await getUsage(tenantId);
    expect(usage.limit).toBe(10_000);
  });

  test("defaults to free plan for non-existent tenant", async () => {
    const usage = await getUsage("nonexistent-tenant");
    expect(usage.plan).toBe("free");
    expect(usage.limit).toBe(10_000);
  });
});

describe("isOverLimit", () => {
  test("returns false for new tenant", async () => {
    const over = await isOverLimit(tenantId);
    expect(over).toBe(false);
  });

  test("returns false when under limit", async () => {
    await incrementToolCallCount(tenantId);
    const over = await isOverLimit(tenantId);
    expect(over).toBe(false);
  });

  test("returns true when at limit", async () => {
    // Set count to exactly the free limit
    const month = new Date().toISOString().slice(0, 7);
    await db.run(
      "INSERT INTO usage (tenant_id, month, tool_call_count) VALUES (?, ?, ?)",
      [tenantId, month, 10_000]
    );

    const over = await isOverLimit(tenantId);
    expect(over).toBe(true);
  });

  test("returns true when over limit", async () => {
    const month = new Date().toISOString().slice(0, 7);
    await db.run(
      "INSERT INTO usage (tenant_id, month, tool_call_count) VALUES (?, ?, ?)",
      [tenantId, month, 15_000]
    );

    const over = await isOverLimit(tenantId);
    expect(over).toBe(true);
  });

  test("team plan is never over limit", async () => {
    await db.run("UPDATE tenants SET plan = 'team' WHERE id = ?", [tenantId]);
    const month = new Date().toISOString().slice(0, 7);
    await db.run(
      "INSERT INTO usage (tenant_id, month, tool_call_count) VALUES (?, ?, ?)",
      [tenantId, month, 999_999]
    );

    const over = await isOverLimit(tenantId);
    expect(over).toBe(false);
  });
});
