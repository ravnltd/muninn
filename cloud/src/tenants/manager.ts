/**
 * Tenant Manager
 *
 * CRUD operations for tenants: signup, provisioning, BYOD config.
 */

import type { DatabaseAdapter } from "../types";
import { provisionDatabase, deleteDatabase } from "./turso";
import { evictTenant } from "./pool";

export interface Tenant {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  created_at: string;
}

export interface CreateTenantInput {
  email: string;
  name?: string;
  password: string;
}

export interface BYODInput {
  tursoDbUrl: string;
  tursoAuthToken: string;
}

/**
 * Create a new tenant with a managed Turso database.
 */
export async function createTenant(db: DatabaseAdapter, input: CreateTenantInput): Promise<Tenant> {
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password);

  // Check for duplicate email
  const existing = await db.get<{ id: string }>("SELECT id FROM tenants WHERE email = ?", [input.email]);
  if (existing) throw new Error("Email already registered");

  await db.run(
    "INSERT INTO tenants (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
    [id, input.email, input.name ?? null, passwordHash]
  );

  // Provision a Turso database
  const provisioned = await provisionDatabase(id);

  await db.run(
    `INSERT INTO tenant_databases (tenant_id, mode, turso_db_name, turso_db_url, turso_auth_token, export_token)
     VALUES (?, 'managed', ?, ?, ?, ?)`,
    [id, provisioned.name, provisioned.url, provisioned.authToken, provisioned.exportToken]
  );

  return {
    id,
    email: input.email,
    name: input.name ?? null,
    plan: "free",
    created_at: new Date().toISOString(),
  };
}

/**
 * Authenticate a tenant by email and password.
 */
export async function authenticateTenant(
  db: DatabaseAdapter,
  email: string,
  password: string
): Promise<Tenant | null> {
  const record = await db.get<Tenant & { password_hash: string }>(
    "SELECT * FROM tenants WHERE email = ?",
    [email]
  );
  if (!record) return null;

  const valid = await verifyPassword(password, record.password_hash);
  if (!valid) return null;

  return {
    id: record.id,
    email: record.email,
    name: record.name,
    plan: record.plan,
    created_at: record.created_at,
  };
}

/**
 * Get a tenant by ID.
 */
export async function getTenant(db: DatabaseAdapter, tenantId: string): Promise<Tenant | null> {
  return db.get<Tenant>(
    "SELECT id, email, name, plan, created_at FROM tenants WHERE id = ?",
    [tenantId]
  );
}

/**
 * Configure BYOD (Bring Your Own Database) for a tenant.
 */
export async function configureBYOD(
  db: DatabaseAdapter,
  tenantId: string,
  input: BYODInput
): Promise<void> {
  // Get current DB config to clean up managed DB if switching
  const current = await db.get<{ mode: string; turso_db_name: string | null }>(
    "SELECT mode, turso_db_name FROM tenant_databases WHERE tenant_id = ?",
    [tenantId]
  );

  // Evict from pool (will reconnect with new config)
  evictTenant(tenantId);

  if (current) {
    // Update existing config
    await db.run(
      `UPDATE tenant_databases SET mode = 'byod', turso_db_url = ?, turso_auth_token = ?, turso_db_name = NULL, export_token = NULL
       WHERE tenant_id = ?`,
      [input.tursoDbUrl, input.tursoAuthToken, tenantId]
    );

    // Delete old managed DB if switching from managed to BYOD
    if (current.mode === "managed" && current.turso_db_name) {
      deleteDatabase(current.turso_db_name).catch(() => {});
    }
  } else {
    // New BYOD config
    await db.run(
      `INSERT INTO tenant_databases (tenant_id, mode, turso_db_url, turso_auth_token)
       VALUES (?, 'byod', ?, ?)`,
      [tenantId, input.tursoDbUrl, input.tursoAuthToken]
    );
  }
}

/**
 * Delete a tenant and all associated data.
 */
export async function deleteTenant(db: DatabaseAdapter, tenantId: string): Promise<void> {
  // Get DB config to clean up
  const dbConfig = await db.get<{ mode: string; turso_db_name: string | null }>(
    "SELECT mode, turso_db_name FROM tenant_databases WHERE tenant_id = ?",
    [tenantId]
  );

  // Evict from pool
  evictTenant(tenantId);

  // Delete managed Turso DB
  if (dbConfig?.mode === "managed" && dbConfig.turso_db_name) {
    await deleteDatabase(dbConfig.turso_db_name).catch(() => {});
  }

  // Explicit cleanup for tables without ON DELETE CASCADE
  await db.run("UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE tenant_id = ?", [tenantId]);
  await db.run("DELETE FROM oauth_codes WHERE tenant_id = ?", [tenantId]);
  await db.run("DELETE FROM oauth_clients WHERE tenant_id = ?", [tenantId]);
  await db.run("DELETE FROM usage WHERE tenant_id = ?", [tenantId]);

  // Cascade delete (FK constraints handle api_keys, tenant_databases)
  await db.run("DELETE FROM tenant_databases WHERE tenant_id = ?", [tenantId]);
  await db.run("DELETE FROM tenants WHERE id = ?", [tenantId]);
}

async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 12 });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}
