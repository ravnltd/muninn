/**
 * Audit Logging
 *
 * Immutable audit trail for security-relevant actions.
 * Stored in management DB for cross-tenant visibility.
 */

import { getManagementDb } from "../db/management";

export interface AuditEntry {
  id: number;
  tenant_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

/**
 * Log an auditable action.
 */
export async function logAudit(
  tenantId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  extra?: { ip?: string; userAgent?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  try {
    const mgmtDb = await getManagementDb();
    await mgmtDb.run(
      `INSERT INTO audit_log (tenant_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        action,
        resourceType,
        resourceId,
        extra?.ip ?? null,
        extra?.userAgent ?? null,
        extra?.metadata ? JSON.stringify(extra.metadata) : null,
      ]
    );
  } catch {
    // Audit logging should never break the main flow
    // Table may not exist yet during migration
  }
}

/**
 * Query audit log for a tenant (paginated).
 */
export async function getAuditLog(
  tenantId: string,
  limit = 50,
  offset = 0
): Promise<{ entries: AuditEntry[]; total: number }> {
  const mgmtDb = await getManagementDb();

  const countResult = await mgmtDb.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ?",
    [tenantId]
  );

  const entries = await mgmtDb.all<AuditEntry>(
    "SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [tenantId, limit, offset]
  );

  return {
    entries,
    total: countResult?.count ?? 0,
  };
}
