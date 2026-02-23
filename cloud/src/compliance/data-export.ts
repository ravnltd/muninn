/**
 * GDPR/CCPA Data Export & Deletion
 *
 * Provides data portability (Article 20) and right to erasure (Article 17).
 */

import { getTenantDb } from "../tenants/pool";
import { deleteTenant } from "../tenants/manager";
import { getManagementDb } from "../db/management";
import { logAudit } from "./audit-log";

const EXPORT_TABLES = [
  "projects",
  "files",
  "learnings",
  "decisions",
  "issues",
  "sessions",
  "session_files",
  "patterns",
] as const;

interface ExportData {
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

/**
 * Export all tenant data as JSON (GDPR Article 20).
 */
export async function exportTenantData(tenantId: string): Promise<ExportData> {
  const db = await getTenantDb(tenantId);
  const tables: Record<string, unknown[]> = {};

  for (const table of EXPORT_TABLES) {
    try {
      const rows = await db.all(`SELECT * FROM ${table}`);
      tables[table] = rows;
    } catch {
      // Table may not exist in tenant's schema version
      tables[table] = [];
    }
  }

  await logAudit(tenantId, "data_export", "account", tenantId);

  return {
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/**
 * Full data erasure (GDPR Article 17).
 * Deletes tenant DB, management records, and cache entries.
 */
export async function eraseTenantData(tenantId: string): Promise<void> {
  await logAudit(tenantId, "data_erasure_requested", "account", tenantId);

  const mgmtDb = await getManagementDb();
  await deleteTenant(mgmtDb, tenantId);

  await logAudit(tenantId, "data_erasure_completed", "account", tenantId);
}
