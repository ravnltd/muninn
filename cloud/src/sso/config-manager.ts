/**
 * SSO Configuration Manager
 *
 * CRUD for SSO configs per tenant. Supports SAML and OIDC.
 * OIDC client secrets are encrypted with AES-256-GCM.
 */

import type { DatabaseAdapter } from "../types";

export interface SsoConfig {
  id: string;
  tenant_id: string;
  provider: "saml" | "oidc";
  entity_id: string | null;
  sso_url: string | null;
  slo_url: string | null;
  certificate_pem: string | null;
  oidc_issuer: string | null;
  oidc_client_id: string | null;
  domain: string | null;
  enforce_sso: boolean;
  allow_password_fallback: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertSsoInput {
  provider: "saml" | "oidc";
  entityId?: string;
  ssoUrl?: string;
  sloUrl?: string;
  certificatePem?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  domain?: string;
  enforceSso?: boolean;
  allowPasswordFallback?: boolean;
}

export async function getSsoConfig(db: DatabaseAdapter, tenantId: string): Promise<SsoConfig | null> {
  const row = await db.get<SsoConfig & { enforce_sso: number; allow_password_fallback: number }>(
    "SELECT * FROM sso_configs WHERE tenant_id = ?",
    [tenantId]
  );
  if (!row) return null;
  return {
    ...row,
    enforce_sso: row.enforce_sso === 1,
    allow_password_fallback: row.allow_password_fallback === 1,
  };
}

export async function upsertSsoConfig(
  db: DatabaseAdapter,
  tenantId: string,
  input: UpsertSsoInput
): Promise<SsoConfig> {
  const existing = await getSsoConfig(db, tenantId);

  // Validate certificate if provided
  if (input.certificatePem) {
    if (!input.certificatePem.includes("BEGIN CERTIFICATE")) {
      throw new Error("Invalid certificate PEM format");
    }
  }

  // Encrypt OIDC client secret if provided
  let encryptedSecret: string | null = null;
  if (input.oidcClientSecret) {
    encryptedSecret = await encryptSecret(input.oidcClientSecret);
  }

  if (existing) {
    await db.run(
      `UPDATE sso_configs SET
        provider = ?, entity_id = ?, sso_url = ?, slo_url = ?,
        certificate_pem = ?, oidc_issuer = ?, oidc_client_id = ?,
        oidc_client_secret_encrypted = COALESCE(?, oidc_client_secret_encrypted),
        domain = ?, enforce_sso = ?, allow_password_fallback = ?,
        updated_at = datetime('now')
      WHERE tenant_id = ?`,
      [
        input.provider,
        input.entityId ?? existing.entity_id,
        input.ssoUrl ?? existing.sso_url,
        input.sloUrl ?? existing.slo_url,
        input.certificatePem ?? existing.certificate_pem,
        input.oidcIssuer ?? existing.oidc_issuer,
        input.oidcClientId ?? existing.oidc_client_id,
        encryptedSecret,
        input.domain ?? existing.domain,
        input.enforceSso !== undefined ? (input.enforceSso ? 1 : 0) : (existing.enforce_sso ? 1 : 0),
        input.allowPasswordFallback !== undefined ? (input.allowPasswordFallback ? 1 : 0) : (existing.allow_password_fallback ? 1 : 0),
        tenantId,
      ]
    );
  } else {
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO sso_configs (id, tenant_id, provider, entity_id, sso_url, slo_url, certificate_pem, oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, domain, enforce_sso, allow_password_fallback)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        input.provider,
        input.entityId ?? null,
        input.ssoUrl ?? null,
        input.sloUrl ?? null,
        input.certificatePem ?? null,
        input.oidcIssuer ?? null,
        input.oidcClientId ?? null,
        encryptedSecret,
        input.domain ?? null,
        input.enforceSso ? 1 : 0,
        input.allowPasswordFallback !== false ? 1 : 0,
      ]
    );
  }

  return (await getSsoConfig(db, tenantId))!;
}

export async function deleteSsoConfig(db: DatabaseAdapter, tenantId: string): Promise<boolean> {
  const result = await db.run("DELETE FROM sso_configs WHERE tenant_id = ?", [tenantId]);
  return (result.changes ?? 0) > 0;
}

// ============================================================================
// Encryption helpers for OIDC client secrets
// ============================================================================

function getEncryptionKey(): Uint8Array {
  const keyBase64 = process.env.SSO_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error("SSO_ENCRYPTION_KEY environment variable is required for OIDC configuration");
  }
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) {
    throw new Error("SSO_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return keyBytes;
}

async function encryptSecret(plaintext: string): Promise<string> {
  const keyBytes = getEncryptionKey();
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  // Format: iv:ciphertext (both base64)
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return `${ivB64}:${ctB64}`;
}

export async function decryptSecret(encrypted: string): Promise<string> {
  const keyBytes = getEncryptionKey();
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const [ivB64, ctB64] = encrypted.split(":");
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
