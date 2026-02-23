/**
 * E2E: Billing Flow
 *
 * Tests billing-related endpoints: checkout session creation, portal access,
 * and webhook signature validation. Stripe API calls are mocked since we
 * cannot make real Stripe requests in tests.
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

// Mock Stripe — checkout and portal require Stripe API keys
mock.module("../../src/billing/stripe", () => ({
  createCheckoutSession: async (_db: DatabaseAdapter, _tenantId: string, plan: string) => {
    if (plan !== "pro") throw new Error(`Unknown plan: ${plan}`);
    return { url: "https://checkout.stripe.com/c/pay_test_123" };
  },
  createBillingPortalSession: async (_db: DatabaseAdapter, tenantId: string) => {
    // Check if tenant has a stripe_customer_id
    const tenant = await _db.get<{ stripe_customer_id: string | null }>(
      "SELECT stripe_customer_id FROM tenants WHERE id = ?",
      [tenantId]
    );
    if (!tenant?.stripe_customer_id) {
      throw new Error("No billing account found. Subscribe to a plan first.");
    }
    return { url: "https://billing.stripe.com/p/session_test_123" };
  },
  handleStripeWebhook: async (_db: DatabaseAdapter, _payload: string, signature: string) => {
    // Simulate signature verification — only accept a specific test signature
    if (signature !== "valid-test-signature") {
      throw new Error("Webhook signature verification failed");
    }
  },
}));

const { api } = await import("../../src/api/routes");

// Build a test app matching server.ts structure (API routes + webhook)
const app = new Hono();

// Stripe webhook (mounted at top level like in server.ts)
app.post("/webhooks/stripe", async (c) => {
  const signature = c.req.header("Stripe-Signature");
  if (!signature) return c.json({ error: "Missing Stripe-Signature" }, 400);

  try {
    const rawBody = await c.req.text();
    const { handleStripeWebhook } = await import("../../src/billing/stripe");
    const mgmtDb = await (await import("../../src/db/management")).getManagementDb();
    await handleStripeWebhook(mgmtDb, rawBody, signature);
    return c.json({ received: true });
  } catch {
    return c.json({ error: "Webhook processing failed" }, 400);
  }
});

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
  return app.request(`http://localhost${path}`, init);
}

async function signupAndGetKey(): Promise<{ apiKey: string; tenantId: string }> {
  const res = await request("POST", "/api/signup", {
    email: `billing-${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: "password123",
    name: "Billing Tester",
  });
  const body = await res.json();
  return { apiKey: body.apiKey, tenantId: body.tenant.id };
}

function authedRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
) {
  return request(method, path, body, { Authorization: `Bearer ${apiKey}` });
}

describe("E2E: Billing Flow", () => {
  describe("POST /api/billing/checkout", () => {
    test("returns checkout URL for pro plan", async () => {
      const { apiKey } = await signupAndGetKey();

      const res = await authedRequest(apiKey, "POST", "/api/billing/checkout", {
        plan: "pro",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.url).toBeDefined();
      expect(body.url).toContain("stripe.com");
    });

    test("rejects invalid plan", async () => {
      const { apiKey } = await signupAndGetKey();

      const res = await authedRequest(apiKey, "POST", "/api/billing/checkout", {
        plan: "enterprise",
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    test("rejects empty body", async () => {
      const { apiKey } = await signupAndGetKey();

      const res = await authedRequest(apiKey, "POST", "/api/billing/checkout");
      expect(res.status).toBe(400);
    });

    test("requires authentication", async () => {
      const res = await request("POST", "/api/billing/checkout", { plan: "pro" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/billing/portal", () => {
    test("rejects tenant without stripe customer", async () => {
      const { apiKey } = await signupAndGetKey();

      // New tenants have no stripe_customer_id
      const res = await authedRequest(apiKey, "POST", "/api/billing/portal");
      // Should return an error (the mock checks for stripe_customer_id)
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    test("returns portal URL for tenant with stripe customer", async () => {
      const { apiKey, tenantId } = await signupAndGetKey();

      // Simulate having a Stripe customer
      await db.run(
        "UPDATE tenants SET stripe_customer_id = ? WHERE id = ?",
        ["cus_test_123", tenantId]
      );

      const res = await authedRequest(apiKey, "POST", "/api/billing/portal");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.url).toBeDefined();
      expect(body.url).toContain("stripe.com");
    });

    test("requires authentication", async () => {
      const res = await request("POST", "/api/billing/portal");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /webhooks/stripe", () => {
    test("rejects request without Stripe-Signature header", async () => {
      const res = await app.request("http://localhost/webhooks/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe("Missing Stripe-Signature");
    });

    test("rejects invalid signature", async () => {
      const res = await app.request("http://localhost/webhooks/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": "invalid-signature",
        },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe("Webhook processing failed");
    });

    test("accepts valid signature", async () => {
      const res = await app.request("http://localhost/webhooks/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": "valid-test-signature",
        },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.received).toBe(true);
    });
  });

  describe("Usage tracking", () => {
    test("new signup starts with zero usage on free plan", async () => {
      const { apiKey } = await signupAndGetKey();

      const res = await authedRequest(apiKey, "GET", "/api/usage");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.plan).toBe("free");
      expect(body.limit).toBe(10_000);
      expect(body.toolCallCount).toBe(0);
    });
  });
});
