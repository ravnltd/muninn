/**
 * Tests for auth middleware
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { authMiddleware, resetKeyStore } from "../src/middleware/auth";

type TestEnv = {
  Variables: {
    tenantId: string;
    appId: string;
  };
};

function createTestApp(): Hono<TestEnv> {
  const app = new Hono<TestEnv>();
  app.use("*", authMiddleware());
  app.get("/test", (c) => {
    return c.json({
      tenantId: c.get("tenantId"),
      appId: c.get("appId"),
    });
  });
  return app;
}

describe("authMiddleware", () => {
  const originalEnv = process.env.API_KEYS;

  beforeEach(() => {
    resetKeyStore();
    process.env.API_KEYS = "mk_testkey123";
  });

  afterEach(() => {
    resetKeyStore();
    if (originalEnv !== undefined) {
      process.env.API_KEYS = originalEnv;
    } else {
      delete process.env.API_KEYS;
    }
  });

  it("rejects requests without Authorization header", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: { "X-Muninn-App": "test" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authorization");
  });

  it("rejects requests without Bearer prefix", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: {
        Authorization: "Basic mk_testkey123",
        "X-Muninn-App": "test",
      },
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid API key", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: {
        Authorization: "Bearer mk_invalid",
        "X-Muninn-App": "test",
      },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid API key");
  });

  it("rejects requests without X-Muninn-App header", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: {
        Authorization: "Bearer mk_testkey123",
      },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("X-Muninn-App");
  });

  it("accepts valid API key and app header", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      headers: {
        Authorization: "Bearer mk_testkey123",
        "X-Muninn-App": "huginn",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("default");
    expect(body.appId).toBe("huginn");
  });

  it("supports tenant:key format", async () => {
    resetKeyStore();
    process.env.API_KEYS = "testuser:mk_testkey123";

    const app = createTestApp();
    const res = await app.request("/test", {
      headers: {
        Authorization: "Bearer mk_rosskey123",
        "X-Muninn-App": "huginn",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("testuser");
  });

  it("supports multiple keys", async () => {
    resetKeyStore();
    process.env.API_KEYS = "mk_key1,mk_key2";

    const app = createTestApp();

    const res1 = await app.request("/test", {
      headers: {
        Authorization: "Bearer mk_key1",
        "X-Muninn-App": "huginn",
      },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", {
      headers: {
        Authorization: "Bearer mk_key2",
        "X-Muninn-App": "studio",
      },
    });
    expect(res2.status).toBe(200);
  });
});
