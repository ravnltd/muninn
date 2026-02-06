/**
 * Tests for REST API routes using Hono's test client.
 *
 * Mocks management DB and Turso provisioning to test
 * request/response handling without external dependencies.
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockDb, seedTenant } from "./mock-db";
import type { DatabaseAdapter } from "../src/types";

let db: DatabaseAdapter;

// Mock management DB
mock.module("../src/db/management", () => ({
  getManagementDb: async () => db,
}));

// Mock Turso provisioning
mock.module("../src/tenants/turso", () => ({
  provisionDatabase: async (tenantId: string) => ({
    name: `muninn-${tenantId.slice(0, 8)}`,
    url: `https://muninn-${tenantId.slice(0, 8)}.turso.io`,
    authToken: "mock-token",
    exportToken: "mock-export",
  }),
  deleteDatabase: async () => {},
}));

// Mock pool
mock.module("../src/tenants/pool", () => ({
  evictTenant: () => {},
}));

const { api } = await import("../src/api/routes");

// Create a test app
const app = new Hono();
app.route("/api", api);

beforeEach(() => {
  db = createMockDb();
});

// Helper: send request to test app
async function request(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api${path}`, init);
}

describe("POST /api/signup", () => {
  test("creates tenant and returns API key", async () => {
    const res = await request("POST", "/signup", {
      email: "new@example.com",
      password: "password123",
      name: "New User",
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.tenant.email).toBe("new@example.com");
    expect(body.apiKey).toBeDefined();
    expect(body.apiKey.startsWith("mk_")).toBe(true);
    expect(body.setup.command).toContain("claude mcp add");
  });

  test("rejects short password", async () => {
    const res = await request("POST", "/signup", {
      email: "short@example.com",
      password: "short",
    });
    expect(res.status).toBe(400);
  });

  test("rejects invalid email", async () => {
    const res = await request("POST", "/signup", {
      email: "not-an-email",
      password: "password123",
    });
    expect(res.status).toBe(400);
  });

  test("rejects duplicate email", async () => {
    await request("POST", "/signup", {
      email: "dup@example.com",
      password: "password123",
    });
    const res = await request("POST", "/signup", {
      email: "dup@example.com",
      password: "otherpass123",
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/login", () => {
  test("returns API key for valid credentials", async () => {
    await request("POST", "/signup", {
      email: "login@example.com",
      password: "correctpass",
    });

    const res = await request("POST", "/login", {
      email: "login@example.com",
      password: "correctpass",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tenant.email).toBe("login@example.com");
    expect(body.apiKey.startsWith("mk_")).toBe(true);
  });

  test("returns 401 for wrong password", async () => {
    await request("POST", "/signup", {
      email: "wrongpw@example.com",
      password: "correctpass",
    });

    const res = await request("POST", "/login", {
      email: "wrongpw@example.com",
      password: "wrongpass",
    });
    expect(res.status).toBe(401);
  });

  test("returns 401 for non-existent email", async () => {
    const res = await request("POST", "/login", {
      email: "ghost@example.com",
      password: "anything",
    });
    expect(res.status).toBe(401);
  });
});

describe("Protected routes (require auth)", () => {
  let apiKey: string;
  let tid: string;

  beforeEach(async () => {
    const res = await request("POST", "/signup", {
      email: "protected@example.com",
      password: "password123",
    });
    const body = await res.json();
    apiKey = body.apiKey;
    tid = body.tenant.id;
  });

  function authed(method: string, path: string, body?: unknown) {
    return request(method, path, body, { Authorization: `Bearer ${apiKey}` });
  }

  describe("GET /api/account", () => {
    test("returns account info", async () => {
      const res = await authed("GET", "/account");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.tenant.email).toBe("protected@example.com");
      expect(body.usage).toBeDefined();
      expect(body.usage.toolCallCount).toBe(0);
    });

    test("returns 401 without auth", async () => {
      const res = await request("GET", "/account");
      expect(res.status).toBe(401);
    });

    test("returns 401 with invalid key", async () => {
      const res = await request("GET", "/account", undefined, {
        Authorization: "Bearer mk_invalid",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/keys", () => {
    test("creates a new API key", async () => {
      const res = await authed("POST", "/keys", { name: "CI Server" });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.key.startsWith("mk_")).toBe(true);
      expect(body.name).toBe("CI Server");
    });

    test("works without name", async () => {
      const res = await authed("POST", "/keys");
      expect(res.status).toBe(201);
    });
  });

  describe("GET /api/keys", () => {
    test("lists API keys", async () => {
      await authed("POST", "/keys", { name: "Key A" });
      await authed("POST", "/keys", { name: "Key B" });

      const res = await authed("GET", "/keys");
      expect(res.status).toBe(200);

      const body = await res.json();
      // At least 3: the original signup key + 2 we just created
      expect(body.keys.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("DELETE /api/keys/:id", () => {
    test("revokes a key", async () => {
      const createRes = await authed("POST", "/keys", { name: "Temp Key" });
      const { id } = await createRes.json();

      const res = await authed("DELETE", `/keys/${id}`);
      expect(res.status).toBe(200);
    });

    test("returns 404 for non-existent key", async () => {
      const res = await authed("DELETE", "/keys/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/usage", () => {
    test("returns usage data", async () => {
      const res = await authed("GET", "/usage");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.plan).toBe("free");
      expect(body.limit).toBe(10_000);
      expect(body.toolCallCount).toBe(0);
    });
  });

  describe("GET /api/export-token", () => {
    test("returns export token for managed DB", async () => {
      const res = await authed("GET", "/export-token");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.exportToken).toBe("mock-export");
    });
  });

  describe("DELETE /api/account", () => {
    test("deletes the account", async () => {
      const res = await authed("DELETE", "/account");
      expect(res.status).toBe(200);

      // Verify tenant is gone
      const tenant = await db.get("SELECT id FROM tenants WHERE id = ?", [tid]);
      expect(tenant).toBeNull();
    });
  });
});
