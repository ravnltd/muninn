/**
 * Tenant Connection Pool
 *
 * LRU pool mapping tenant_id -> DatabaseAdapter.
 * Evicts least-recently-used connections when at capacity.
 */

import { HttpAdapter, type DatabaseAdapter } from "../types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface PoolEntry {
  db: DatabaseAdapter;
  lastUsed: number;
}

interface TenantDbConfig {
  turso_db_url: string;
  turso_auth_token: string;
  schema_version: number;
}

const MAX_POOL_SIZE = 200;
const pool = new Map<string, PoolEntry>();

let _mgmtDb: DatabaseAdapter | null = null;

/**
 * Set the management DB reference (called once at startup).
 */
export function setManagementDb(db: DatabaseAdapter): void {
  _mgmtDb = db;
}

function getMgmtDb(): DatabaseAdapter {
  if (!_mgmtDb) throw new Error("Management DB not initialized. Call setManagementDb() first.");
  return _mgmtDb;
}

/**
 * Get a tenant's database adapter (cached in LRU pool).
 */
export async function getTenantDb(tenantId: string): Promise<DatabaseAdapter> {
  const cached = pool.get(tenantId);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.db;
  }

  // Evict LRU if full
  if (pool.size >= MAX_POOL_SIZE) {
    evictLRU();
  }

  // Load tenant's DB config from management DB
  const mgmtDb = getMgmtDb();
  const config = await mgmtDb.get<TenantDbConfig>(
    "SELECT turso_db_url, turso_auth_token, schema_version FROM tenant_databases WHERE tenant_id = ?",
    [tenantId]
  );

  if (!config) throw new Error(`No database configured for tenant ${tenantId}`);

  const db = new HttpAdapter({
    primaryUrl: config.turso_db_url,
    authToken: config.turso_auth_token,
  });
  await db.init();

  // Ensure tenant's muninn schema is initialized
  const schemaExists = await checkTenantSchema(db);
  if (!schemaExists) {
    await initTenantSchema(db);
    await mgmtDb.run(
      "UPDATE tenant_databases SET schema_version = 1 WHERE tenant_id = ?",
      [tenantId]
    );
  }

  pool.set(tenantId, { db, lastUsed: Date.now() });
  return db;
}

/**
 * Remove a tenant from the pool (e.g., on account deletion).
 */
export function evictTenant(tenantId: string): void {
  const entry = pool.get(tenantId);
  if (entry) {
    entry.db.close();
    pool.delete(tenantId);
  }
}

/**
 * Get pool statistics.
 */
export function getPoolStats(): { size: number; maxSize: number } {
  return { size: pool.size, maxSize: MAX_POOL_SIZE };
}

function evictLRU(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of pool) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    const entry = pool.get(oldestKey);
    entry?.db.close();
    pool.delete(oldestKey);
  }
}

async function checkTenantSchema(db: DatabaseAdapter): Promise<boolean> {
  try {
    await db.get("SELECT 1 FROM projects LIMIT 1");
    return true;
  } catch {
    return false;
  }
}

async function initTenantSchema(db: DatabaseAdapter): Promise<void> {
  // Use the main muninn schema.sql (the per-project schema)
  const schemaPath = join(import.meta.dir, "..", "..", "..", "schema.sql");
  const schemaSql = readFileSync(schemaPath, "utf-8");
  await db.exec(schemaSql);
}
