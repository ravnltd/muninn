/**
 * SSO Configuration API Routes
 *
 * Admin routes for managing SSO settings per tenant.
 * Requires manage_sso permission (owner only).
 */

import { Hono } from "hono";
import { z } from "zod";
import { getManagementDb } from "../db/management";
import { requirePermission } from "../rbac/permissions";
import { getSsoConfig, upsertSsoConfig, deleteSsoConfig } from "../sso/config-manager";
import { logAudit } from "../compliance/audit-log";
import type { AuthedEnv } from "./middleware";

const ssoAdmin = new Hono<AuthedEnv>();

// All SSO config routes require manage_sso permission (owner only)
ssoAdmin.use("/*", requirePermission("manage_sso"));

// Get current SSO config
ssoAdmin.get("/config", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  const config = await getSsoConfig(mgmtDb, tenantId);

  if (!config) {
    return c.json({ configured: false });
  }

  return c.json({
    configured: true,
    provider: config.provider,
    entityId: config.entity_id,
    ssoUrl: config.sso_url,
    sloUrl: config.slo_url,
    hasCertificate: !!config.certificate_pem,
    oidcIssuer: config.oidc_issuer,
    oidcClientId: config.oidc_client_id,
    domain: config.domain,
    enforceSso: config.enforce_sso,
    allowPasswordFallback: config.allow_password_fallback,
  });
});

// Create/update SSO config
const SsoConfigInput = z.object({
  provider: z.enum(["saml", "oidc"]),
  entityId: z.string().max(500).optional(),
  ssoUrl: z.string().url().optional(),
  sloUrl: z.string().url().optional(),
  certificatePem: z.string().max(10000).optional(),
  oidcIssuer: z.string().url().optional(),
  oidcClientId: z.string().max(200).optional(),
  oidcClientSecret: z.string().max(500).optional(),
  domain: z.string().max(200).optional(),
  enforceSso: z.boolean().optional(),
  allowPasswordFallback: z.boolean().optional(),
});

ssoAdmin.put("/config", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = SsoConfigInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message ?? "Validation failed" }, 400);
  }

  try {
    const mgmtDb = await getManagementDb();
    const config = await upsertSsoConfig(mgmtDb, tenantId, parsed.data);

    await logAudit(tenantId, "update_sso_config", "sso_config", config.id, {
      userId: c.get("userId"),
      metadata: { provider: parsed.data.provider },
    });

    return c.json({ success: true, provider: config.provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update SSO config";
    return c.json({ error: message }, 400);
  }
});

// Delete SSO config
ssoAdmin.delete("/config", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();

  const deleted = await deleteSsoConfig(mgmtDb, tenantId);
  if (!deleted) {
    return c.json({ error: "No SSO configuration found" }, 404);
  }

  await logAudit(tenantId, "delete_sso_config", "sso_config", tenantId, {
    userId: c.get("userId"),
  });

  return c.json({ success: true });
});

// Test SSO config (validates configuration is parseable)
ssoAdmin.post("/test", async (c) => {
  const tenantId = c.get("tenantId");
  const mgmtDb = await getManagementDb();
  const config = await getSsoConfig(mgmtDb, tenantId);

  if (!config) {
    return c.json({ error: "No SSO configuration found" }, 404);
  }

  const issues: string[] = [];

  if (config.provider === "saml") {
    if (!config.sso_url) issues.push("SSO URL is required");
    if (!config.certificate_pem) issues.push("IdP certificate is recommended for signature verification");
  } else if (config.provider === "oidc") {
    if (!config.oidc_issuer) issues.push("OIDC issuer is required");
    if (!config.oidc_client_id) issues.push("OIDC client ID is required");
  }

  return c.json({
    valid: issues.length === 0,
    issues,
    provider: config.provider,
  });
});

export { ssoAdmin as ssoAdminRoutes };
