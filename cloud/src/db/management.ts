/**
 * Management Database Adapter
 *
 * Single Turso database we own, storing tenant metadata.
 * Uses the same HttpAdapter from muninn core.
 */

import { HttpAdapter, type HttpAdapterConfig, type DatabaseAdapter } from "../types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let instance: DatabaseAdapter | null = null;

function getConfig(): HttpAdapterConfig {
  const url = process.env.MGMT_DB_URL;
  if (!url) throw new Error("MGMT_DB_URL environment variable is required");

  return {
    primaryUrl: url,
    authToken: process.env.MGMT_DB_TOKEN,
    timeout: 10_000,
  };
}

export async function getManagementDb(): Promise<DatabaseAdapter> {
  if (instance) return instance;

  const adapter = new HttpAdapter(getConfig());
  await adapter.init();

  // Check if schema exists, init if needed
  const exists = await checkSchemaExists(adapter);
  if (!exists) {
    const schemaPath = join(import.meta.dir, "schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");
    await adapter.exec(schemaSql);
  } else {
    // Apply new tables for existing deployments (IF NOT EXISTS is safe to re-run)
    await applyMigrations(adapter);
  }

  instance = adapter;
  return adapter;
}

async function checkSchemaExists(adapter: DatabaseAdapter): Promise<boolean> {
  try {
    await adapter.get("SELECT 1 FROM tenants LIMIT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply incremental migrations for existing databases.
 * Uses CREATE TABLE/INDEX IF NOT EXISTS so safe to re-run.
 */
async function applyMigrations(adapter: DatabaseAdapter): Promise<void> {
  try {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(tenant_id, action);
    `);
  } catch {
    // Non-fatal — audit logging degrades gracefully
  }
}
