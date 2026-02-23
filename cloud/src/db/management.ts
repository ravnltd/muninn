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

  // Rate limiting persistence
  try {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_state (
        key TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        tokens REAL NOT NULL,
        last_refill_ms INTEGER NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key, instance_id)
      );
      CREATE TABLE IF NOT EXISTS rate_limit_violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        key TEXT NOT NULL,
        plan TEXT NOT NULL,
        limit_value INTEGER NOT NULL,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch {
    // Non-fatal
  }

  // RBAC: Users and invitations
  try {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        name TEXT,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tenant_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(tenant_id, email);
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        invited_by_user_id TEXT NOT NULL REFERENCES users(id),
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token_hash);
    `);
  } catch {
    // Non-fatal
  }

  // Add user_id columns to existing tables (idempotent)
  const alterColumns = [
    { table: "api_keys", column: "user_id", type: "TEXT" },
    { table: "oauth_tokens", column: "user_id", type: "TEXT" },
    { table: "oauth_codes", column: "user_id", type: "TEXT" },
    { table: "audit_log", column: "user_id", type: "TEXT" },
  ];
  for (const { table, column, type } of alterColumns) {
    try {
      await adapter.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch {
      // Column already exists — expected
    }
  }

  // SSO tables
  try {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS sso_configs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'saml',
        entity_id TEXT,
        sso_url TEXT,
        slo_url TEXT,
        certificate_pem TEXT,
        oidc_issuer TEXT,
        oidc_client_id TEXT,
        oidc_client_secret_encrypted TEXT,
        domain TEXT,
        enforce_sso INTEGER NOT NULL DEFAULT 0,
        allow_password_fallback INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS saml_relay_state (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        client_id TEXT,
        redirect_uri TEXT,
        code_challenge TEXT,
        state TEXT,
        scope TEXT,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch {
    // Non-fatal
  }

  // Tenant settings (webhook config, etc.)
  try {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS tenant_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tenant_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant ON tenant_settings(tenant_id);
    `);
  } catch {
    // Non-fatal
  }

  // Data migration: Create owner user for each existing tenant
  try {
    const tenants = await adapter.all<{ id: string; email: string; name: string | null; password_hash: string }>(
      "SELECT id, email, name, password_hash FROM tenants"
    );
    for (const t of tenants) {
      const existing = await adapter.get<{ id: string }>(
        "SELECT id FROM users WHERE tenant_id = ? AND role = 'owner'",
        [t.id]
      );
      if (!existing) {
        const userId = crypto.randomUUID();
        await adapter.run(
          `INSERT OR IGNORE INTO users (id, tenant_id, email, name, password_hash, role, status)
           VALUES (?, ?, ?, ?, ?, 'owner', 'active')`,
          [userId, t.id, t.email, t.name, t.password_hash]
        );
      }
    }
  } catch {
    // Non-fatal — users table might not exist yet in edge cases
  }
}
