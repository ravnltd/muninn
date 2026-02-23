/**
 * SSO Routes
 *
 * Handles SAML/OIDC authentication flows.
 * Integrates with existing OAuth flow by creating authorization codes.
 */

import { Hono } from "hono";
import { getManagementDb } from "../db/management";
import { getSsoConfig } from "./config-manager";
import { generateAuthnRequest, validateSamlResponse, generateSpMetadata } from "./saml-provider";
import { provisionOrUpdateUser } from "./jit-provisioning";
import { createAuthorizationCode } from "../auth/provider";
import { logAudit } from "../compliance/audit-log";
import type { DatabaseAdapter } from "../types";

const sso = new Hono();

const RELAY_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Store OAuth params in relay state during SSO redirect.
 */
async function storeRelayState(
  db: DatabaseAdapter,
  tenantId: string,
  params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scope: string;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + RELAY_STATE_TTL_MS;

  await db.run(
    `INSERT INTO saml_relay_state (id, tenant_id, client_id, redirect_uri, code_challenge, state, scope, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, tenantId, params.clientId, params.redirectUri, params.codeChallenge, params.state, params.scope, expiresAt]
  );

  return id;
}

interface RelayStateRecord {
  id: string;
  tenant_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  scope: string;
  expires_at: number;
}

async function consumeRelayState(db: DatabaseAdapter, relayStateId: string): Promise<RelayStateRecord | null> {
  const record = await db.get<RelayStateRecord>(
    "SELECT * FROM saml_relay_state WHERE id = ? AND expires_at > ?",
    [relayStateId, Date.now()]
  );

  if (record) {
    await db.run("DELETE FROM saml_relay_state WHERE id = ?", [relayStateId]);
  }

  return record;
}

// ============================================================================
// SSO Login Initiation
// ============================================================================

sso.get("/login", async (c) => {
  const tenantId = c.req.query("tenant_id");
  const clientId = c.req.query("client_id");
  const redirectUri = c.req.query("redirect_uri");
  const codeChallenge = c.req.query("code_challenge") ?? "";
  const state = c.req.query("state") ?? "";
  const scope = c.req.query("scope") ?? "mcp:tools";

  if (!tenantId || !clientId || !redirectUri) {
    return c.json({ error: "Missing tenant_id, client_id, or redirect_uri" }, 400);
  }

  const mgmtDb = await getManagementDb();
  const config = await getSsoConfig(mgmtDb, tenantId);
  if (!config) {
    return c.json({ error: "SSO not configured for this tenant" }, 404);
  }

  if (config.provider === "saml") {
    // Store OAuth params in relay state
    const relayStateId = await storeRelayState(mgmtDb, tenantId, {
      clientId,
      redirectUri,
      codeChallenge,
      state,
      scope,
    });

    const { redirectUrl } = generateAuthnRequest(config, relayStateId);
    return c.redirect(redirectUrl, 302);
  }

  // OIDC flow (future implementation)
  return c.json({ error: "OIDC SSO not yet implemented" }, 501);
});

// ============================================================================
// SAML Assertion Consumer Service (ACS)
// ============================================================================

sso.post("/acs", async (c) => {
  const form = await c.req.parseBody();
  const samlResponse = form["SAMLResponse"] as string;
  const relayStateId = form["RelayState"] as string;

  if (!samlResponse || !relayStateId) {
    return c.json({ error: "Missing SAMLResponse or RelayState" }, 400);
  }

  const mgmtDb = await getManagementDb();

  // Retrieve and consume relay state
  const relayState = await consumeRelayState(mgmtDb, relayStateId);
  if (!relayState) {
    return c.json({ error: "Invalid or expired relay state" }, 400);
  }

  // Get SSO config for the tenant
  const config = await getSsoConfig(mgmtDb, relayState.tenant_id);
  if (!config) {
    return c.json({ error: "SSO configuration not found" }, 400);
  }

  // Validate SAML response
  let assertion;
  try {
    assertion = await validateSamlResponse(samlResponse, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SAML validation failed";
    await logAudit(relayState.tenant_id, "sso_login_failed", "sso", relayState.tenant_id, {
      metadata: { error: message },
    });
    return c.json({ error: message }, 400);
  }

  // JIT provision user
  const email = assertion.attributes.email || assertion.nameId;
  const name = assertion.attributes.displayName ||
    [assertion.attributes.firstName, assertion.attributes.lastName].filter(Boolean).join(" ") ||
    undefined;

  const userId = await provisionOrUpdateUser(mgmtDb, relayState.tenant_id, { email, name });

  // Create OAuth authorization code (bridges SSO into existing OAuth flow)
  const scopes = relayState.scope ? relayState.scope.split(" ") : ["mcp:tools"];
  const code = await createAuthorizationCode(
    mgmtDb,
    relayState.client_id,
    relayState.tenant_id,
    relayState.redirect_uri,
    relayState.code_challenge || null,
    scopes,
    userId
  );

  await logAudit(relayState.tenant_id, "sso_login", "user", userId, {
    metadata: { email, provider: "saml" },
  });

  // Redirect back to OAuth redirect_uri with authorization code
  const url = new URL(relayState.redirect_uri);
  url.searchParams.set("code", code);
  if (relayState.state) url.searchParams.set("state", relayState.state);

  return c.redirect(url.toString(), 302);
});

// ============================================================================
// SP Metadata
// ============================================================================

sso.get("/metadata/:tenantId", (c) => {
  const tenantId = c.req.param("tenantId");
  const metadata = generateSpMetadata(tenantId);
  c.header("Content-Type", "application/xml");
  return c.body(metadata);
});

export { sso as ssoRoutes };
