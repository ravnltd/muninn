/**
 * E2E: Signup Flow
 *
 * Tests the full lifecycle: signup -> use API key -> verify account -> duplicate rejection.
 * Uses Hono test client with mocked DB and Turso provisioning.
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockDb } from "../mock-db";
import type { DatabaseAdapter } from "../../src/types";

let db: DatabaseAdapter;

// Mock management DB
mock.module("../../src/db/management", () => ({
  getManagementDb: async () => db,
}));

// Mock Turso provisioning
mock.module("../../src/tenants/turso", () => ({
  provisionDatabase: async (tenantId: string) => ({
    name: `muninn-${tenantId.slice(0, 8)}`,
    url: `https://muninn-${tenantId.slice(0, 8)}.turso.io`,
    authToken: "mock-token",
    exportToken: "mock-export",
  }),
  deleteDatabase: async () => {},
}));

// Mock pool
mock.module("../../src/tenants/pool", () => ({
  evictTenant: () => {},
  setManagementDb: () => {},
  getPoolStats: () => ({ size: 0, maxSize: 200 }),
  getTenantDb: async () => db,
}));

const { api } = await import("../../src/api/routes");

const app = new Hono();
app.route("/api", api);

beforeEach(() => {
  db = createMockDb();
});

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api${path}`, init);
}

describe("E2E: Signup Flow", () => {
  test("full signup -> authenticate -> verify account", async () => {
    // Step 1: Sign up
    const signupRes = await request("POST", "/signup", {
      email: "alice@example.com",
      password: "securepass123",
      name: "Alice",
    });
    expect(signupRes.status).toBe(201);

    const signupBody = await signupRes.json();

    // Step 2: Verify signup response structure
    expect(signupBody.tenant).toBeDefined();
    expect(signupBody.tenant.email).toBe("alice@example.com");
    expect(signupBody.tenant.name).toBe("Alice");
    expect(signupBody.tenant.plan).toBe("free");
    expect(signupBody.tenant.id).toBeDefined();

    expect(signupBody.apiKey).toBeDefined();
    expect(signupBody.apiKey.startsWith("mk_")).toBe(true);

    expect(signupBody.setup).toBeDefined();
    expect(signupBody.setup.command).toContain("YOUR_API_KEY");
    expect(signupBody.setup.command).toContain("claude mcp add");
    expect(signupBody.setup.note).toBeDefined();

    // Step 3: Use the returned API key to access account
    const accountRes = await request("GET", "/account", undefined, {
      Authorization: `Bearer ${signupBody.apiKey}`,
    });
    expect(accountRes.status).toBe(200);

    const accountBody = await accountRes.json();
    expect(accountBody.tenant.email).toBe("alice@example.com");
    expect(accountBody.tenant.name).toBe("Alice");
    expect(accountBody.tenant.id).toBe(signupBody.tenant.id);
    expect(accountBody.usage).toBeDefined();
    expect(accountBody.usage.toolCallCount).toBe(0);
  });

  test("duplicate email returns 409 without leaking email", async () => {
    // First signup
    await request("POST", "/signup", {
      email: "bob@example.com",
      password: "password123",
      name: "Bob",
    });

    // Duplicate signup
    const dupRes = await request("POST", "/signup", {
      email: "bob@example.com",
      password: "differentpass456",
      name: "Not Bob",
    });
    expect(dupRes.status).toBe(409);

    const dupBody = await dupRes.json();
    // Error message should not reveal that this specific email exists
    expect(dupBody.error).toBeDefined();
    expect(dupBody.error).not.toContain("bob@example.com");
  });

  test("signup with minimal fields (no name)", async () => {
    const res = await request("POST", "/signup", {
      email: "minimal@example.com",
      password: "password123",
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.tenant.email).toBe("minimal@example.com");
    expect(body.apiKey.startsWith("mk_")).toBe(true);
  });

  test("signup then login with same credentials", async () => {
    await request("POST", "/signup", {
      email: "logintest@example.com",
      password: "mypassword123",
      name: "Login Tester",
    });

    const loginRes = await request("POST", "/login", {
      email: "logintest@example.com",
      password: "mypassword123",
    });
    expect(loginRes.status).toBe(200);

    const loginBody = await loginRes.json();
    expect(loginBody.tenant.email).toBe("logintest@example.com");
    expect(loginBody.apiKey.startsWith("mk_")).toBe(true);

    // New login key should also work for account access
    const accountRes = await request("GET", "/account", undefined, {
      Authorization: `Bearer ${loginBody.apiKey}`,
    });
    expect(accountRes.status).toBe(200);
  });

  test("signup API key can manage additional keys", async () => {
    const signupRes = await request("POST", "/signup", {
      email: "keymgr@example.com",
      password: "password123",
    });
    const { apiKey } = await signupRes.json();

    // Create a second key
    const createRes = await request("POST", "/keys", { name: "CI Key" }, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(createRes.status).toBe(201);

    const createBody = await createRes.json();
    expect(createBody.key.startsWith("mk_")).toBe(true);
    expect(createBody.name).toBe("CI Key");

    // List keys should show at least 2
    const listRes = await request("GET", "/keys", undefined, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(listRes.status).toBe(200);

    const listBody = await listRes.json();
    expect(listBody.keys.length).toBeGreaterThanOrEqual(2);
  });

  test("deleted account API key stops working", async () => {
    const signupRes = await request("POST", "/signup", {
      email: "delete-me@example.com",
      password: "password123",
    });
    const { apiKey } = await signupRes.json();

    // Delete account
    const deleteRes = await request("DELETE", "/account", undefined, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(deleteRes.status).toBe(200);

    // API key should no longer work — key verifies but tenant row is gone,
    // so the account endpoint returns 404 (tenant not found)
    const accountRes = await request("GET", "/account", undefined, {
      Authorization: `Bearer ${apiKey}`,
    });
    // After deletion: either 401 (key invalidated) or 404 (tenant gone) is acceptable
    expect([401, 404]).toContain(accountRes.status);
  });
});
