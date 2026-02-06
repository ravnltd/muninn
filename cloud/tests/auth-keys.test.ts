/**
 * Tests for API key generation, verification, revocation, and listing.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { createMockDb, seedTenant } from "./mock-db";
import { generateApiKey, verifyApiKey, revokeApiKey, listApiKeys } from "../src/auth/keys";
import type { DatabaseAdapter } from "../src/types";

let db: DatabaseAdapter;
let tenantId: string;

beforeEach(async () => {
  db = createMockDb();
  const tenant = await seedTenant(db);
  tenantId = tenant.id;
});

describe("generateApiKey", () => {
  test("returns key with mk_ prefix", async () => {
    const { key } = await generateApiKey(db, tenantId);
    expect(key.startsWith("mk_")).toBe(true);
  });

  test("key is 67 chars (mk_ + 64 hex)", async () => {
    const { key } = await generateApiKey(db, tenantId);
    expect(key.length).toBe(3 + 64); // "mk_" + 32 bytes hex
  });

  test("record has correct tenant_id", async () => {
    const { record } = await generateApiKey(db, tenantId);
    expect(record.tenant_id).toBe(tenantId);
  });

  test("record has display prefix with ellipsis", async () => {
    const { record } = await generateApiKey(db, tenantId);
    expect(record.key_prefix.startsWith("mk_")).toBe(true);
    expect(record.key_prefix.endsWith("...")).toBe(true);
    // "mk_" + 8 chars + "..." = 14
    expect(record.key_prefix.length).toBe(14);
  });

  test("record has default scopes", async () => {
    const { record } = await generateApiKey(db, tenantId);
    expect(record.scopes).toBe('["mcp:tools"]');
  });

  test("stores name when provided", async () => {
    const { record } = await generateApiKey(db, tenantId, "My Laptop");
    expect(record.name).toBe("My Laptop");
  });

  test("name is null when not provided", async () => {
    const { record } = await generateApiKey(db, tenantId);
    expect(record.name).toBeNull();
  });

  test("key is persisted in database", async () => {
    const { record } = await generateApiKey(db, tenantId);
    const stored = await db.get<{ id: string }>("SELECT id FROM api_keys WHERE id = ?", [record.id]);
    expect(stored).not.toBeNull();
  });

  test("hash is stored, not the raw key", async () => {
    const { key, record } = await generateApiKey(db, tenantId);
    // The hash should NOT contain the raw key
    expect(record.key_hash).not.toContain(key);
    // Hash should be 64 hex chars (SHA-256)
    expect(record.key_hash.length).toBe(64);
  });

  test("generates unique keys", async () => {
    const { key: key1 } = await generateApiKey(db, tenantId);
    const { key: key2 } = await generateApiKey(db, tenantId);
    expect(key1).not.toBe(key2);
  });
});

describe("verifyApiKey", () => {
  test("returns record for valid key", async () => {
    const { key } = await generateApiKey(db, tenantId);
    const record = await verifyApiKey(db, key);
    expect(record).not.toBeNull();
    expect(record!.tenant_id).toBe(tenantId);
  });

  test("returns null for invalid key", async () => {
    const result = await verifyApiKey(db, "mk_0000000000000000000000000000000000000000000000000000000000000000");
    expect(result).toBeNull();
  });

  test("returns null for non-mk_ prefix", async () => {
    const result = await verifyApiKey(db, "sk_something");
    expect(result).toBeNull();
  });

  test("returns null for empty string", async () => {
    const result = await verifyApiKey(db, "");
    expect(result).toBeNull();
  });

  test("returns null for revoked key", async () => {
    const { key, record } = await generateApiKey(db, tenantId);
    await revokeApiKey(db, record.id, tenantId);
    const result = await verifyApiKey(db, key);
    expect(result).toBeNull();
  });
});

describe("revokeApiKey", () => {
  test("returns true when key exists", async () => {
    const { record } = await generateApiKey(db, tenantId);
    const revoked = await revokeApiKey(db, record.id, tenantId);
    expect(revoked).toBe(true);
  });

  test("returns false for non-existent key", async () => {
    const revoked = await revokeApiKey(db, "non-existent", tenantId);
    expect(revoked).toBe(false);
  });

  test("returns false for wrong tenant", async () => {
    const { record } = await generateApiKey(db, tenantId);
    const revoked = await revokeApiKey(db, record.id, "wrong-tenant-id");
    expect(revoked).toBe(false);
  });

  test("sets revoked_at timestamp", async () => {
    const { record } = await generateApiKey(db, tenantId);
    await revokeApiKey(db, record.id, tenantId);
    const stored = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM api_keys WHERE id = ?",
      [record.id]
    );
    expect(stored!.revoked_at).not.toBeNull();
  });
});

describe("listApiKeys", () => {
  test("returns empty array for tenant with no keys", async () => {
    const keys = await listApiKeys(db, tenantId);
    expect(keys).toEqual([]);
  });

  test("returns all keys for tenant", async () => {
    await generateApiKey(db, tenantId, "Key 1");
    await generateApiKey(db, tenantId, "Key 2");
    const keys = await listApiKeys(db, tenantId);
    expect(keys.length).toBe(2);
  });

  test("does not include key_hash in results", async () => {
    await generateApiKey(db, tenantId);
    const keys = await listApiKeys(db, tenantId);
    const firstKey = keys[0] as Record<string, unknown>;
    expect(firstKey.key_hash).toBeUndefined();
  });

  test("does not return keys from other tenants", async () => {
    const otherTenant = await seedTenant(db);
    await generateApiKey(db, tenantId, "My key");
    await generateApiKey(db, otherTenant.id, "Other key");

    const myKeys = await listApiKeys(db, tenantId);
    expect(myKeys.length).toBe(1);
    expect(myKeys[0].name).toBe("My key");
  });

  test("includes revoked keys", async () => {
    const { record } = await generateApiKey(db, tenantId);
    await revokeApiKey(db, record.id, tenantId);
    const keys = await listApiKeys(db, tenantId);
    expect(keys.length).toBe(1);
    expect(keys[0].revoked_at).not.toBeNull();
  });
});
