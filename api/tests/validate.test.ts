/**
 * Tests for validation middleware
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { validateBody } from "../src/middleware/validate";

const TestSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
});

function createTestApp() {
  const app = new Hono();
  app.post("/test", validateBody(TestSchema), (c) => {
    const body = c.get("validatedBody");
    return c.json(body);
  });
  return app;
}

describe("validateBody middleware", () => {
  it("passes valid body through", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", age: 25 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Test");
    expect(body.age).toBe(25);
  });

  it("rejects invalid body", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", age: -1 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeArray();
  });

  it("rejects non-JSON body", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });
});
