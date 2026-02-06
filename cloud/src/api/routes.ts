/**
 * REST API Routes
 *
 * Account management: signup, login, API keys, account info, BYOD.
 */

import { Hono } from "hono";
import { z } from "zod";
import { getManagementDb } from "../db/management";
import { createTenant, authenticateTenant, getTenant, configureBYOD, deleteTenant } from "../tenants/manager";
import { generateApiKey, revokeApiKey, listApiKeys } from "../auth/keys";
import { getUsage } from "../billing/metering";
import { bearerAuth, type AuthedEnv } from "./middleware";

const api = new Hono<AuthedEnv>();

// ============================================================================
// Public Routes (no auth required)
// ============================================================================

const SignupInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
});

api.post("/signup", async (c) => {
  const body = await c.req.json();
  const parsed = SignupInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message ?? "Validation failed" }, 400);
  }

  try {
    const mgmtDb = await getManagementDb();
    const tenant = await createTenant(mgmtDb, parsed.data);

    // Auto-generate first API key
    const { key } = await generateApiKey(mgmtDb, tenant.id, "Default");

    return c.json({
      tenant: { id: tenant.id, email: tenant.email, name: tenant.name, plan: tenant.plan },
      apiKey: key,
      setup: {
        command: `claude mcp add --transport http muninn https://api.muninn.pro/mcp --header "Authorization: Bearer ${key}"`,
      },
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signup failed";
    if (message.includes("already registered")) {
      return c.json({ error: message }, 409);
    }
    return c.json({ error: message }, 500);
  }
});

const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

api.post("/login", async (c) => {
  const body = await c.req.json();
  const parsed = LoginInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid credentials" }, 400);
  }

  const mgmtDb = await getManagementDb();
  const tenant = await authenticateTenant(mgmtDb, parsed.data.email, parsed.data.password);
  if (!tenant) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Generate a new API key as session token
  const { key } = await generateApiKey(mgmtDb, tenant.id, "Login session");

  return c.json({
    tenant: { id: tenant.id, email: tenant.email, name: tenant.name, plan: tenant.plan },
    apiKey: key,
  });
});

// ============================================================================
// Protected Routes (auth required)
// ============================================================================

const authed = new Hono<AuthedEnv>();
authed.use("*", bearerAuth());

// Account info
authed.get("/account", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  const tenant = await getTenant(mgmtDb, tenantId);
  if (!tenant) return c.json({ error: "Account not found" }, 404);

  const usage = await getUsage(tenantId);

  return c.json({
    tenant: { id: tenant.id, email: tenant.email, name: tenant.name, plan: tenant.plan },
    usage: {
      toolCallCount: usage.toolCallCount,
      limit: usage.limit,
      month: new Date().toISOString().slice(0, 7),
    },
  });
});

// Delete account
authed.delete("/account", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  await deleteTenant(mgmtDb, tenantId);
  return c.json({ success: true });
});

// API Keys
const CreateKeyInput = z.object({
  name: z.string().min(1).max(100).optional(),
});

authed.post("/keys", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateKeyInput.safeParse(body);

  const mgmtDb = await getManagementDb();
  const { key, record } = await generateApiKey(mgmtDb, tenantId, parsed.success ? parsed.data.name : undefined);

  return c.json({
    key,
    id: record.id,
    prefix: record.key_prefix,
    name: record.name,
    createdAt: record.created_at,
  }, 201);
});

authed.get("/keys", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  const keys = await listApiKeys(mgmtDb, tenantId);
  return c.json({ keys });
});

authed.delete("/keys/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const keyId = c.req.param("id");
  const mgmtDb = await getManagementDb();
  const revoked = await revokeApiKey(mgmtDb, keyId, tenantId);
  if (!revoked) return c.json({ error: "Key not found" }, 404);
  return c.json({ success: true });
});

// BYOD Configuration
const BYODInput = z.object({
  tursoDbUrl: z.string().url(),
  tursoAuthToken: z.string().min(1),
});

authed.put("/database", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json();
  const parsed = BYODInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message ?? "Validation failed" }, 400);
  }

  const mgmtDb = await getManagementDb();
  await configureBYOD(mgmtDb, tenantId, parsed.data);
  return c.json({ success: true, mode: "byod" });
});

// Usage
authed.get("/usage", async (c) => {
  const tenantId = c.get("tenantId");
  const usage = await getUsage(tenantId);
  return c.json(usage);
});

// Export token (for data portability)
authed.get("/export-token", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  const dbConfig = await mgmtDb.get<{ export_token: string | null; mode: string }>(
    "SELECT export_token, mode FROM tenant_databases WHERE tenant_id = ?",
    [tenantId]
  );

  if (!dbConfig) return c.json({ error: "No database configured" }, 404);
  if (dbConfig.mode === "byod") {
    return c.json({ error: "BYOD databases are managed by you directly" }, 400);
  }
  if (!dbConfig.export_token) {
    return c.json({ error: "Export token not available" }, 404);
  }

  return c.json({ exportToken: dbConfig.export_token });
});

// Mount protected routes
api.route("/", authed);

export { api };
