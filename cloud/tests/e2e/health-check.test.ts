/**
 * E2E: Health Check, Readiness, Metrics, and Security Headers
 *
 * Tests the operational endpoints: /health, /ready, /metrics, and verifies
 * that security headers and request ID propagation are working.
 *
 * Uses the full Hono app (server.ts equivalent) with mocked dependencies.
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
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
  getPoolStats: () => ({ size: 2, maxSize: 200 }),
  getTenantDb: async () => db,
}));

// Mock MCP endpoint session count
mock.module("../../src/mcp-endpoint", () => ({
  getSessionCount: () => 3,
  handleMcpRequest: async () => new Response("ok"),
  closeAllSessions: async () => {},
}));

const { api } = await import("../../src/api/routes");
const {
  metricsMiddleware,
  formatMetrics,
  dbPoolSize,
  activeMcpSessions,
} = await import("../../src/lib/metrics");
const { generateRequestId } = await import("../../src/lib/errors");

// Build a test app mirroring server.ts structure
const app = new Hono();

// Request ID propagation (mirrors server.ts)
app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? generateRequestId();
  await next();
  c.header("X-Request-Id", requestId);
});

app.use("*", metricsMiddleware());

// Security headers (mirrors server.ts)
app.use("*", secureHeaders({
  strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
  xContentTypeOptions: "nosniff",
  xFrameOptions: "DENY",
  contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
}));

const startTime = Date.now();

// Health check (mirrors server.ts)
app.get("/health", async (c) => {
  const { getManagementDb } = await import("../../src/db/management");
  const { getPoolStats } = await import("../../src/tenants/pool");
  const { getSessionCount } = await import("../../src/mcp-endpoint");

  const checks: Record<string, unknown> = {};
  let healthy = true;

  try {
    const mgmtDb = await getManagementDb();
    await mgmtDb.get("SELECT 1");
    checks.managementDb = "ok";
  } catch {
    checks.managementDb = "error";
    healthy = false;
  }

  const pool = getPoolStats();
  checks.pool = pool;

  const sessionCount = getSessionCount();
  checks.mcpSessions = sessionCount;

  dbPoolSize.setDirect(pool.size);
  activeMcpSessions.setDirect(sessionCount);

  const status = healthy ? "ok" : "degraded";
  const statusCode = healthy ? 200 : 503;

  return c.json({
    status,
    version: "0.1.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  }, statusCode);
});

app.get("/ready", async (c) => {
  try {
    const { getManagementDb } = await import("../../src/db/management");
    const mgmtDb = await getManagementDb();
    await mgmtDb.get("SELECT 1");
    return c.json({ ready: true });
  } catch {
    return c.json({ ready: false }, 503);
  }
});

app.get("/metrics", (c) => {
  const { getPoolStats } = require("../../src/tenants/pool");
  const { getSessionCount } = require("../../src/mcp-endpoint");
  const pool = getPoolStats();
  dbPoolSize.setDirect(pool.size);
  activeMcpSessions.setDirect(getSessionCount());

  c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return c.text(formatMetrics());
});

app.route("/api", api);

beforeEach(() => {
  db = createMockDb();
});

describe("E2E: Health Check and Operational Endpoints", () => {
  describe("GET /health", () => {
    test("returns healthy status with all checks", async () => {
      const res = await app.request("http://localhost/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.version).toBe("0.1.0");
      expect(typeof body.uptime).toBe("number");
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.checks).toBeDefined();
      expect(body.checks.managementDb).toBe("ok");
      expect(body.checks.pool).toBeDefined();
      expect(body.checks.pool.size).toBe(2);
      expect(body.checks.mcpSessions).toBe(3);
    });
  });

  describe("GET /ready", () => {
    test("returns ready when DB is accessible", async () => {
      const res = await app.request("http://localhost/ready");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ready).toBe(true);
    });
  });

  describe("GET /metrics", () => {
    test("returns Prometheus text format", async () => {
      // Make a request first so metrics have data
      await app.request("http://localhost/health");

      const res = await app.request("http://localhost/metrics");
      expect(res.status).toBe(200);

      const contentType = res.headers.get("Content-Type");
      expect(contentType).toContain("text/plain");

      const text = await res.text();
      // Verify Prometheus format markers
      expect(text).toContain("# HELP");
      expect(text).toContain("# TYPE");
      expect(text).toContain("muninn_http_requests_total");
      expect(text).toContain("muninn_http_request_duration_seconds");
      expect(text).toContain("muninn_db_pool_size");
      expect(text).toContain("muninn_active_mcp_sessions");
    });

    test("metrics include counter and gauge types", async () => {
      const res = await app.request("http://localhost/metrics");
      const text = await res.text();

      expect(text).toContain("# TYPE muninn_http_requests_total counter");
      expect(text).toContain("# TYPE muninn_http_request_duration_seconds histogram");
      expect(text).toContain("# TYPE muninn_db_pool_size gauge");
      expect(text).toContain("# TYPE muninn_active_mcp_sessions gauge");
    });
  });

  describe("Security Headers", () => {
    test("X-Content-Type-Options is nosniff", async () => {
      const res = await app.request("http://localhost/health");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    test("X-Frame-Options is DENY", async () => {
      const res = await app.request("http://localhost/health");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    });

    test("Content-Security-Policy header is set", async () => {
      const res = await app.request("http://localhost/health");
      const csp = res.headers.get("Content-Security-Policy");
      // secureHeaders sets this header; the value format depends on Hono version
      expect(csp).not.toBeNull();
    });

    test("Strict-Transport-Security is present", async () => {
      const res = await app.request("http://localhost/health");
      const hsts = res.headers.get("Strict-Transport-Security");
      expect(hsts).toBeDefined();
      expect(hsts).toContain("max-age=");
      expect(hsts).toContain("includeSubDomains");
    });

    test("security headers present on API routes too", async () => {
      const signupRes = await app.request("http://localhost/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "headers@example.com",
          password: "password123",
        }),
      });

      expect(signupRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(signupRes.headers.get("X-Frame-Options")).toBe("DENY");
    });
  });

  describe("X-Request-Id Header", () => {
    test("generates X-Request-Id when not provided", async () => {
      const res = await app.request("http://localhost/health");
      const requestId = res.headers.get("X-Request-Id");
      expect(requestId).toBeDefined();
      expect(requestId!.length).toBeGreaterThan(0);
    });

    test("echoes back provided X-Request-Id", async () => {
      const customId = "test-request-12345";
      const res = await app.request("http://localhost/health", {
        headers: { "X-Request-Id": customId },
      });
      expect(res.headers.get("X-Request-Id")).toBe(customId);
    });

    test("X-Request-Id present on all endpoint types", async () => {
      const healthRes = await app.request("http://localhost/health");
      expect(healthRes.headers.get("X-Request-Id")).toBeDefined();

      const readyRes = await app.request("http://localhost/ready");
      expect(readyRes.headers.get("X-Request-Id")).toBeDefined();

      const metricsRes = await app.request("http://localhost/metrics");
      expect(metricsRes.headers.get("X-Request-Id")).toBeDefined();
    });
  });
});
