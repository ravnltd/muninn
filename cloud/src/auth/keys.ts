/**
 * API Key Generation and Management
 *
 * Keys have format: mk_<32 random bytes hex>
 * Stored as SHA-256 hash. Prefix "mk_" + first 8 chars stored for display.
 */

import type { DatabaseAdapter } from "../types";

const KEY_PREFIX = "mk_";
const KEY_BYTES = 32;
const API_KEY_TTL_MS = 90 * 24 * 3600 * 1000; // 90 days

export interface ApiKeyRecord {
  id: string;
  tenant_id: string;
  key_prefix: string;
  key_hash: string;
  name: string | null;
  scopes: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  created_at: string;
}

/**
 * Generate a new API key. Returns the raw key (only shown once) and its record.
 */
export async function generateApiKey(
  db: DatabaseAdapter,
  tenantId: string,
  name?: string
): Promise<{ key: string; record: ApiKeyRecord }> {
  const rawBytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const hex = Array.from(rawBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const key = `${KEY_PREFIX}${hex}`;

  const id = crypto.randomUUID();
  const keyHash = await hashKey(key);
  const keyPrefixDisplay = `${KEY_PREFIX}${hex.slice(0, 8)}...`;
  const expiresAt = new Date(Date.now() + API_KEY_TTL_MS).toISOString();

  const record: ApiKeyRecord = {
    id,
    tenant_id: tenantId,
    key_prefix: keyPrefixDisplay,
    key_hash: keyHash,
    name: name ?? null,
    scopes: '["mcp:tools"]',
    last_used_at: null,
    revoked_at: null,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };

  await db.run(
    `INSERT INTO api_keys (id, tenant_id, key_prefix, key_hash, name, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.tenant_id, record.key_prefix, record.key_hash, record.name, record.scopes, record.expires_at, record.created_at]
  );

  return { key, record };
}

/**
 * Verify an API key and return its record, or null if invalid.
 */
export async function verifyApiKey(db: DatabaseAdapter, key: string): Promise<ApiKeyRecord | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;

  const keyHash = await hashKey(key);
  const record = await db.get<ApiKeyRecord>(
    "SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
    [keyHash]
  );

  if (!record) return null;

  // Check if key has expired
  if (record.expires_at && new Date(record.expires_at) < new Date()) return null;

  // Update last_used_at (fire and forget)
  db.run("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?", [record.id]).catch(() => {});

  return record;
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(db: DatabaseAdapter, keyId: string, tenantId: string): Promise<boolean> {
  const result = await db.run(
    "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND tenant_id = ?",
    [keyId, tenantId]
  );
  return Number(result.changes) > 0;
}

/**
 * List API keys for a tenant (never returns the actual key hash).
 */
export async function listApiKeys(
  db: DatabaseAdapter,
  tenantId: string
): Promise<Array<Omit<ApiKeyRecord, "key_hash">>> {
  return db.all(
    "SELECT id, tenant_id, key_prefix, name, scopes, last_used_at, revoked_at, expires_at, created_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC",
    [tenantId]
  );
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
