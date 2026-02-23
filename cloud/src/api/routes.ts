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
import { createCheckoutSession, createBillingPortalSession } from "../billing/stripe";
import { bearerAuth, type AuthedEnv } from "./middleware";
import { sanitizeError, generateRequestId } from "../lib/errors";
import { logAudit } from "../compliance/audit-log";
import { requirePermission } from "../rbac/permissions";
import { teamRoutes } from "./team-routes";
import { inviteAcceptRoutes } from "./team-routes";
import { ssoAdminRoutes } from "./sso-routes";
import { knowledgeRoutes } from "./knowledge-routes";
import { webhookRoutes } from "./webhook-routes";

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

    await logAudit(tenant.id, "signup", "account", tenant.id, {
      ip: c.req.header("X-Real-IP") ?? c.req.header("X-Forwarded-For"),
    });

    return c.json({
      tenant: { id: tenant.id, email: tenant.email, name: tenant.name, plan: tenant.plan },
      apiKey: key,
      setup: {
        command: `claude mcp add --transport http muninn https://api.muninn.pro/mcp --header "Authorization: Bearer YOUR_API_KEY"`,
        note: "Replace YOUR_API_KEY with the apiKey value above. This key is shown once — save it now.",
      },
    }, 201);
  } catch (error) {
    const requestId = generateRequestId();
    const safe = sanitizeError(error, "signup", requestId, 500);
    return c.json({ error: safe.message, requestId: safe.requestId }, safe.status as 500);
  }
});

const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(6),
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

// Delete account (owner only)
authed.delete("/account", requirePermission("delete_account"), async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  await deleteTenant(mgmtDb, tenantId);
  return c.json({ success: true });
});

// API Keys (admin+ only)
authed.use("/keys/*", requirePermission("manage_keys"));
authed.use("/keys", requirePermission("manage_keys"));

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

authed.put("/database", requirePermission("manage_keys"), async (c) => {
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

// Billing: Checkout
const CheckoutInput = z.object({
  plan: z.enum(["pro"]),
});

authed.post("/billing/checkout", requirePermission("manage_billing"), async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = CheckoutInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid plan" }, 400);
  }

  try {
    const mgmtDb = await getManagementDb();
    const { url } = await createCheckoutSession(mgmtDb, tenantId, parsed.data.plan);
    return c.json({ url });
  } catch (error) {
    const requestId = generateRequestId();
    const safe = sanitizeError(error, "checkout", requestId, 500);
    return c.json({ error: safe.message, requestId: safe.requestId }, safe.status as 500);
  }
});

// Billing: Portal
authed.post("/billing/portal", requirePermission("manage_billing"), async (c) => {
  const tenantId = c.get("tenantId");
  try {
    const mgmtDb = await getManagementDb();
    const { url } = await createBillingPortalSession(mgmtDb, tenantId);
    return c.json({ url });
  } catch (error) {
    const requestId = generateRequestId();
    const safe = sanitizeError(error, "billing-portal", requestId, 400);
    return c.json({ error: safe.message, requestId: safe.requestId }, safe.status as 400);
  }
});

// Data export (GDPR Article 20)
authed.get("/export", async (c) => {
  const tenantId = c.get("tenantId");
  const { exportTenantData } = await import("../compliance/data-export");
  const data = await exportTenantData(tenantId);
  return c.json(data);
});

// Data deletion (GDPR Article 17, owner only)
authed.post("/delete-my-data", requirePermission("delete_account"), async (c) => {
  const tenantId = c.get("tenantId");
  const { eraseTenantData } = await import("../compliance/data-export");
  await eraseTenantData(tenantId);
  return c.json({ success: true, message: "All data has been permanently deleted" });
});

// Audit log
authed.get("/audit-log", async (c) => {
  const tenantId = c.get("tenantId");
  const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
  const { getAuditLog } = await import("../compliance/audit-log");
  const result = await getAuditLog(tenantId, limit, offset);
  return c.json(result);
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

// Mount team routes (protected by bearerAuth + manage_team permission)
authed.route("/team", teamRoutes);

// Mount SSO admin routes (protected by bearerAuth + manage_sso permission)
authed.route("/sso", ssoAdminRoutes);

// Mount knowledge/memory routes (v6 — knowledge explorer API)
authed.route("/knowledge", knowledgeRoutes);

// Mount protected routes
api.route("/", authed);

// Public invite acceptance (no auth required)
api.route("/invite", inviteAcceptRoutes);

// GitHub webhooks (public, signature-verified)
api.route("/webhooks", webhookRoutes);

export { api };
