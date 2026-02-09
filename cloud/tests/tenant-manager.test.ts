/**
 * Tests for tenant manager: signup, auth, BYOD, deletion.
 *
 * Note: createTenant and deleteTenant call Turso API (provisionDatabase/deleteDatabase).
 * These tests mock the Turso module to avoid real API calls.
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { createMockDb, seedTenant } from "./mock-db";
import type { DatabaseAdapter } from "../src/types";

// Mock the turso module before importing tenant manager
mock.module("../src/tenants/turso", () => ({
  provisionDatabase: async (tenantId: string) => ({
    name: `muninn-${tenantId.slice(0, 8)}`,
    url: `https://muninn-${tenantId.slice(0, 8)}.turso.io`,
    authToken: "mock-auth-token",
    exportToken: "mock-export-token",
  }),
  deleteDatabase: async () => {},
}));

// Mock the pool module to avoid side effects
mock.module("../src/tenants/pool", () => ({
  evictTenant: () => {},
  setManagementDb: () => {},
  getPoolStats: () => ({ size: 0, maxSize: 200 }),
  getTenantDb: async () => db,
}));

// Import after mocking
const { createTenant, authenticateTenant, getTenant, configureBYOD, deleteTenant } = await import(
  "../src/tenants/manager"
);

let db: DatabaseAdapter;

beforeEach(() => {
  db = createMockDb();
});

describe("createTenant", () => {
  test("creates tenant with correct email", async () => {
    const tenant = await createTenant(db, {
      email: "alice@example.com",
      password: "securepass123",
      name: "Alice",
    });
    expect(tenant.email).toBe("alice@example.com");
    expect(tenant.name).toBe("Alice");
    expect(tenant.plan).toBe("free");
  });

  test("generates a UUID for tenant id", async () => {
    const tenant = await createTenant(db, {
      email: "bob@example.com",
      password: "pass123456",
    });
    // UUID format: 8-4-4-4-12
    expect(tenant.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("stores tenant in database", async () => {
    const tenant = await createTenant(db, {
      email: "stored@example.com",
      password: "pass123456",
    });
    const stored = await db.get<{ email: string }>("SELECT email FROM tenants WHERE id = ?", [tenant.id]);
    expect(stored!.email).toBe("stored@example.com");
  });

  test("hashes the password (not stored plaintext)", async () => {
    await createTenant(db, {
      email: "hashed@example.com",
      password: "mypassword",
    });
    const stored = await db.get<{ password_hash: string }>(
      "SELECT password_hash FROM tenants WHERE email = ?",
      ["hashed@example.com"]
    );
    expect(stored!.password_hash).not.toBe("mypassword");
    expect(stored!.password_hash.length).toBeGreaterThan(20);
  });

  test("provisions a Turso database", async () => {
    const tenant = await createTenant(db, {
      email: "provisioned@example.com",
      password: "pass123456",
    });
    const dbConfig = await db.get<{ turso_db_url: string; mode: string }>(
      "SELECT turso_db_url, mode FROM tenant_databases WHERE tenant_id = ?",
      [tenant.id]
    );
    expect(dbConfig).not.toBeNull();
    expect(dbConfig!.mode).toBe("managed");
    expect(dbConfig!.turso_db_url).toContain("turso.io");
  });

  test("rejects duplicate email", async () => {
    await createTenant(db, { email: "dup@example.com", password: "pass123456" });

    try {
      await createTenant(db, { email: "dup@example.com", password: "otherpass" });
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("Email already registered");
    }
  });

  test("name defaults to null", async () => {
    const tenant = await createTenant(db, {
      email: "noname@example.com",
      password: "pass123456",
    });
    expect(tenant.name).toBeNull();
  });
});

describe("authenticateTenant", () => {
  test("returns tenant for valid credentials", async () => {
    await createTenant(db, {
      email: "auth@example.com",
      password: "correctpass",
      name: "Auth User",
    });

    const result = await authenticateTenant(db, "auth@example.com", "correctpass");
    expect(result).not.toBeNull();
    expect(result!.email).toBe("auth@example.com");
    expect(result!.name).toBe("Auth User");
  });

  test("returns null for wrong password", async () => {
    await createTenant(db, {
      email: "wrong@example.com",
      password: "correctpass",
    });

    const result = await authenticateTenant(db, "wrong@example.com", "wrongpass");
    expect(result).toBeNull();
  });

  test("returns null for non-existent email", async () => {
    const result = await authenticateTenant(db, "ghost@example.com", "anything");
    expect(result).toBeNull();
  });

  test("does not leak password_hash", async () => {
    await createTenant(db, {
      email: "noleak@example.com",
      password: "secretpass",
    });

    const result = await authenticateTenant(db, "noleak@example.com", "secretpass");
    const asRecord = result as Record<string, unknown>;
    expect(asRecord.password_hash).toBeUndefined();
  });
});

describe("getTenant", () => {
  test("returns tenant by id", async () => {
    const created = await createTenant(db, {
      email: "get@example.com",
      password: "pass123456",
      name: "Get User",
    });

    const fetched = await getTenant(db, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.email).toBe("get@example.com");
  });

  test("returns null for non-existent id", async () => {
    const result = await getTenant(db, "nonexistent-id");
    expect(result).toBeNull();
  });
});

describe("configureBYOD", () => {
  test("switches from managed to BYOD", async () => {
    const tenant = await createTenant(db, {
      email: "byod@example.com",
      password: "pass123456",
    });

    await configureBYOD(db, tenant.id, {
      tursoDbUrl: "https://my-own-db.turso.io",
      tursoAuthToken: "my-own-token",
    });

    const dbConfig = await db.get<{ mode: string; turso_db_url: string; turso_db_name: string | null }>(
      "SELECT mode, turso_db_url, turso_db_name FROM tenant_databases WHERE tenant_id = ?",
      [tenant.id]
    );
    expect(dbConfig!.mode).toBe("byod");
    expect(dbConfig!.turso_db_url).toBe("https://my-own-db.turso.io");
    expect(dbConfig!.turso_db_name).toBeNull();
  });

  test("creates new config for tenant without database", async () => {
    const tenant = await seedTenant(db);

    await configureBYOD(db, tenant.id, {
      tursoDbUrl: "https://example-byod.turso.io",
      tursoAuthToken: "fresh-token",
    });

    const dbConfig = await db.get<{ mode: string }>(
      "SELECT mode FROM tenant_databases WHERE tenant_id = ?",
      [tenant.id]
    );
    expect(dbConfig!.mode).toBe("byod");
  });
});

describe("deleteTenant", () => {
  test("removes tenant from database", async () => {
    const tenant = await createTenant(db, {
      email: "delete@example.com",
      password: "pass123456",
    });

    await deleteTenant(db, tenant.id);

    const stored = await db.get<{ id: string }>("SELECT id FROM tenants WHERE id = ?", [tenant.id]);
    expect(stored).toBeNull();
  });

  test("removes tenant_databases entry", async () => {
    const tenant = await createTenant(db, {
      email: "delete-db@example.com",
      password: "pass123456",
    });

    await deleteTenant(db, tenant.id);

    const dbConfig = await db.get<{ tenant_id: string }>(
      "SELECT tenant_id FROM tenant_databases WHERE tenant_id = ?",
      [tenant.id]
    );
    expect(dbConfig).toBeNull();
  });

  test("does not throw for non-existent tenant", async () => {
    // Should not throw
    await deleteTenant(db, "nonexistent-tenant-id");
  });
});
