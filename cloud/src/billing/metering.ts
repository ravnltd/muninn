/**
 * Usage Metering
 *
 * Tracks tool call counts per tenant per month.
 * Used for plan enforcement and billing.
 */

import { getManagementDb } from "../db/management";

const PLAN_LIMITS: Record<string, number> = {
  free: 10_000,
  pro: 100_000,
  team: Infinity,
};

/**
 * Increment tool call count for a tenant (current month).
 */
export async function incrementToolCallCount(tenantId: string): Promise<void> {
  const db = await getManagementDb();
  const month = new Date().toISOString().slice(0, 7); // "2026-02"

  await db.run(
    `INSERT INTO usage (tenant_id, month, tool_call_count)
     VALUES (?, ?, 1)
     ON CONFLICT(tenant_id, month) DO UPDATE SET tool_call_count = tool_call_count + 1`,
    [tenantId, month]
  );
}

/**
 * Get current month's usage for a tenant.
 */
export async function getUsage(
  tenantId: string
): Promise<{ toolCallCount: number; queryCount: number; limit: number; plan: string }> {
  const db = await getManagementDb();
  const month = new Date().toISOString().slice(0, 7);

  const tenant = await db.get<{ plan: string }>("SELECT plan FROM tenants WHERE id = ?", [tenantId]);
  const plan = tenant?.plan ?? "free";

  const usage = await db.get<{ tool_call_count: number; query_count: number }>(
    "SELECT tool_call_count, query_count FROM usage WHERE tenant_id = ? AND month = ?",
    [tenantId, month]
  );

  return {
    toolCallCount: usage?.tool_call_count ?? 0,
    queryCount: usage?.query_count ?? 0,
    limit: PLAN_LIMITS[plan] ?? PLAN_LIMITS.free,
    plan,
  };
}

/**
 * Check if a tenant has exceeded their plan limit.
 */
export async function isOverLimit(tenantId: string): Promise<boolean> {
  const usage = await getUsage(tenantId);
  return usage.toolCallCount >= usage.limit;
}
