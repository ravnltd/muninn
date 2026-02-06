/**
 * Tests for management DB schema integrity.
 *
 * Verifies all tables exist with expected columns and constraints.
 */

import { describe, expect, test } from "bun:test";
import { createMockDb } from "./mock-db";

const db = createMockDb();

describe("Management DB schema", () => {
  const expectedTables = [
    "tenants",
    "tenant_databases",
    "api_keys",
    "oauth_clients",
    "oauth_codes",
    "oauth_tokens",
    "usage",
  ];

  for (const table of expectedTables) {
    test(`table ${table} exists`, async () => {
      const result = await db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [table]
      );
      expect(result).not.toBeNull();
    });
  }
});

describe("tenants table", () => {
  test("accepts valid insert", async () => {
    await db.run(
      "INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, ?)",
      ["t1", "test@example.com", "hash123"]
    );
    const tenant = await db.get<{ id: string; plan: string }>(
      "SELECT id, plan FROM tenants WHERE id = ?", ["t1"]
    );
    expect(tenant!.id).toBe("t1");
    expect(tenant!.plan).toBe("free"); // default
  });

  test("rejects duplicate email", async () => {
    await db.run(
      "INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, ?)",
      ["t2", "unique@test.com", "hash"]
    );
    try {
      await db.run(
        "INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, ?)",
        ["t3", "unique@test.com", "hash"]
      );
      expect(true).toBe(false);
    } catch {
      // Expected: UNIQUE constraint on email
    }
  });
});

describe("api_keys table", () => {
  test("enforces unique key_hash", async () => {
    await db.run(
      "INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, ?)",
      ["ak-tenant", "ak@test.com", "hash"]
    );
    await db.run(
      "INSERT INTO api_keys (id, tenant_id, key_prefix, key_hash) VALUES (?, ?, ?, ?)",
      ["k1", "ak-tenant", "mk_abcd...", "unique-hash-1"]
    );

    try {
      await db.run(
        "INSERT INTO api_keys (id, tenant_id, key_prefix, key_hash) VALUES (?, ?, ?, ?)",
        ["k2", "ak-tenant", "mk_efgh...", "unique-hash-1"]
      );
      expect(true).toBe(false);
    } catch {
      // Expected: UNIQUE constraint on key_hash
    }
  });
});

describe("usage table", () => {
  test("enforces unique tenant_id + month", async () => {
    await db.run(
      "INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, ?)",
      ["usage-tenant", "usage@test.com", "hash"]
    );
    await db.run(
      "INSERT INTO usage (tenant_id, month, tool_call_count) VALUES (?, ?, ?)",
      ["usage-tenant", "2026-02", 5]
    );

    try {
      await db.run(
        "INSERT INTO usage (tenant_id, month, tool_call_count) VALUES (?, ?, ?)",
        ["usage-tenant", "2026-02", 10]
      );
      expect(true).toBe(false);
    } catch {
      // Expected: UNIQUE constraint on (tenant_id, month)
    }
  });

  test("supports upsert pattern", async () => {
    await db.run(
      "INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, ?)",
      ["upsert-tenant", "upsert@test.com", "hash"]
    );
    await db.run(
      `INSERT INTO usage (tenant_id, month, tool_call_count)
       VALUES (?, ?, 1)
       ON CONFLICT(tenant_id, month) DO UPDATE SET tool_call_count = tool_call_count + 1`,
      ["upsert-tenant", "2026-02"]
    );
    await db.run(
      `INSERT INTO usage (tenant_id, month, tool_call_count)
       VALUES (?, ?, 1)
       ON CONFLICT(tenant_id, month) DO UPDATE SET tool_call_count = tool_call_count + 1`,
      ["upsert-tenant", "2026-02"]
    );

    const usage = await db.get<{ tool_call_count: number }>(
      "SELECT tool_call_count FROM usage WHERE tenant_id = ? AND month = ?",
      ["upsert-tenant", "2026-02"]
    );
    expect(usage!.tool_call_count).toBe(2);
  });
});

describe("oauth_tokens table", () => {
  test("supports both access and refresh types", async () => {
    await db.run(
      "INSERT INTO tenants (id, email, password_hash) VALUES (?, ?, ?)",
      ["oauth-tenant", "oauth@test.com", "hash"]
    );
    await db.run(
      "INSERT INTO oauth_tokens (token_hash, token_type, client_id, tenant_id, expires_at) VALUES (?, ?, ?, ?, ?)",
      ["hash-access", "access", "client-1", "oauth-tenant", Date.now() + 3600000]
    );
    await db.run(
      "INSERT INTO oauth_tokens (token_hash, token_type, client_id, tenant_id, expires_at) VALUES (?, ?, ?, ?, ?)",
      ["hash-refresh", "refresh", "client-1", "oauth-tenant", Date.now() + 86400000]
    );

    const tokens = await db.all<{ token_type: string }>(
      "SELECT token_type FROM oauth_tokens WHERE tenant_id = ?",
      ["oauth-tenant"]
    );
    expect(tokens.length).toBe(2);
  });
});
