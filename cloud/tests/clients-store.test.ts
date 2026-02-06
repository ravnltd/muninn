/**
 * Tests for OAuth Dynamic Client Registration store.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { createMockDb, seedTenant } from "./mock-db";
import { ClientsStore } from "../src/auth/clients-store";
import type { DatabaseAdapter } from "../src/types";

let db: DatabaseAdapter;
let store: ClientsStore;

beforeEach(() => {
  db = createMockDb();
  store = new ClientsStore(db);
});

describe("registerClient", () => {
  test("returns client with generated id and secret", async () => {
    const client = await store.registerClient(
      ["https://example.com/callback"],
      "My App"
    );
    expect(client.client_id.length).toBeGreaterThan(0);
    expect(client.client_secret.startsWith("cs_")).toBe(true);
  });

  test("stores redirect URIs", async () => {
    const client = await store.registerClient(
      ["https://a.com/cb", "https://b.com/cb"],
      "Multi-redirect App"
    );
    expect(client.redirect_uris).toEqual(["https://a.com/cb", "https://b.com/cb"]);
  });

  test("defaults grant_types", async () => {
    const client = await store.registerClient(["https://example.com/cb"]);
    expect(client.grant_types).toEqual(["authorization_code", "refresh_token"]);
  });

  test("accepts custom grant_types", async () => {
    const client = await store.registerClient(
      ["https://example.com/cb"],
      "Custom",
      ["authorization_code"]
    );
    expect(client.grant_types).toEqual(["authorization_code"]);
  });

  test("stores client name", async () => {
    const client = await store.registerClient(["https://example.com/cb"], "Claude Code");
    expect(client.client_name).toBe("Claude Code");
  });

  test("client_name is undefined when not provided", async () => {
    const client = await store.registerClient(["https://example.com/cb"]);
    expect(client.client_name).toBeUndefined();
  });

  test("generates unique IDs", async () => {
    const c1 = await store.registerClient(["https://a.com/cb"]);
    const c2 = await store.registerClient(["https://b.com/cb"]);
    expect(c1.client_id).not.toBe(c2.client_id);
  });

  test("generates unique secrets", async () => {
    const c1 = await store.registerClient(["https://a.com/cb"]);
    const c2 = await store.registerClient(["https://b.com/cb"]);
    expect(c1.client_secret).not.toBe(c2.client_secret);
  });
});

describe("getClient", () => {
  test("returns registered client", async () => {
    const registered = await store.registerClient(["https://example.com/cb"], "Test App");
    const fetched = await store.getClient(registered.client_id);

    expect(fetched).not.toBeNull();
    expect(fetched!.client_id).toBe(registered.client_id);
    expect(fetched!.redirect_uris).toEqual(["https://example.com/cb"]);
    expect(fetched!.client_name).toBe("Test App");
  });

  test("returns null for non-existent client", async () => {
    const result = await store.getClient("nonexistent");
    expect(result).toBeNull();
  });

  test("does not return secret in getClient", async () => {
    const registered = await store.registerClient(["https://example.com/cb"]);
    const fetched = await store.getClient(registered.client_id);
    // getClient returns OAuthClient which has optional client_secret
    // but our implementation doesn't include the raw secret (only hash is stored)
    expect(fetched!.client_secret).toBeUndefined();
  });
});

describe("verifyClientSecret", () => {
  test("returns true for correct secret", async () => {
    const client = await store.registerClient(["https://example.com/cb"]);
    const result = await store.verifyClientSecret(client.client_id, client.client_secret);
    expect(result).toBe(true);
  });

  test("returns false for wrong secret", async () => {
    const client = await store.registerClient(["https://example.com/cb"]);
    const result = await store.verifyClientSecret(client.client_id, "cs_wrong_secret");
    expect(result).toBe(false);
  });

  test("returns false for non-existent client", async () => {
    const result = await store.verifyClientSecret("nonexistent", "cs_any");
    expect(result).toBe(false);
  });
});

describe("bindClientToTenant", () => {
  test("associates client with tenant", async () => {
    const tenant = await seedTenant(db);
    const client = await store.registerClient(["https://example.com/cb"]);

    await store.bindClientToTenant(client.client_id, tenant.id);

    const record = await db.get<{ tenant_id: string }>(
      "SELECT tenant_id FROM oauth_clients WHERE client_id = ?",
      [client.client_id]
    );
    expect(record!.tenant_id).toBe(tenant.id);
  });
});
