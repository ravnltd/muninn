/**
 * OAuth Server Provider (Phase 2)
 *
 * Standalone OAuth implementation for Hono (not Express).
 * Handles authorization code grant with PKCE, token exchange, and revocation.
 *
 * Note: Does NOT implement the MCP SDK's OAuthServerProvider (which requires Express).
 * Instead, we implement the same logic directly as Hono route handlers.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { DatabaseAdapter } from "../types";
import { verifyAccessToken } from "./verifier";

const ACCESS_TOKEN_TTL_MS = 3600 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Store an authorization code for the OAuth flow.
 */
export async function createAuthorizationCode(
  db: DatabaseAdapter,
  clientId: string,
  tenantId: string,
  redirectUri: string,
  codeChallenge: string | null,
  scopes: string[] | null
): Promise<string> {
  const code = generateSecureToken();
  const expiresAt = Date.now() + AUTH_CODE_TTL_MS;

  await db.run(
    `INSERT INTO oauth_codes (code, client_id, tenant_id, redirect_uri, code_challenge, code_challenge_method, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?, 'S256', ?, ?)`,
    [code, clientId, tenantId, redirectUri, codeChallenge, scopes ? JSON.stringify(scopes) : null, expiresAt]
  );

  return code;
}

export interface TokenPair {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

/**
 * Exchange an authorization code for tokens.
 * Verifies PKCE code_verifier against stored code_challenge (S256).
 */
export async function exchangeAuthorizationCode(
  db: DatabaseAdapter,
  clientId: string,
  authorizationCode: string,
  codeVerifier?: string,
  redirectUri?: string
): Promise<TokenPair> {
  const codeRecord = await db.get<{
    tenant_id: string;
    scopes: string | null;
    code_challenge: string | null;
    redirect_uri: string;
  }>(
    "SELECT tenant_id, scopes, code_challenge, redirect_uri FROM oauth_codes WHERE code = ? AND client_id = ? AND used_at IS NULL AND expires_at > ?",
    [authorizationCode, clientId, Date.now()]
  );
  if (!codeRecord) throw new Error("Invalid or expired authorization code");

  // Redirect URI verification (RFC 6749 §4.1.3)
  if (redirectUri && codeRecord.redirect_uri !== redirectUri) {
    throw new Error("redirect_uri mismatch");
  }

  // PKCE verification (check both null and empty string)
  if (codeRecord.code_challenge !== null && codeRecord.code_challenge !== "") {
    if (!codeVerifier) throw new Error("code_verifier required for PKCE");
    const computed = await computeS256Challenge(codeVerifier);
    if (computed !== codeRecord.code_challenge) {
      throw new Error("Invalid code_verifier");
    }
  }

  await db.run("UPDATE oauth_codes SET used_at = datetime('now') WHERE code = ?", [authorizationCode]);

  return generateTokenPair(db, clientId, codeRecord.tenant_id, codeRecord.scopes);
}

/**
 * Exchange a refresh token for new tokens.
 */
export async function exchangeRefreshToken(
  db: DatabaseAdapter,
  clientId: string,
  refreshToken: string
): Promise<TokenPair> {
  const refreshHash = await hashToken(refreshToken);
  const record = await db.get<{ tenant_id: string; scopes: string | null }>(
    "SELECT tenant_id, scopes FROM oauth_tokens WHERE token_hash = ? AND token_type = 'refresh' AND client_id = ? AND revoked_at IS NULL AND expires_at > ?",
    [refreshHash, clientId, Date.now()]
  );
  if (!record) throw new Error("Invalid or expired refresh token");

  // Revoke old refresh token (rotation)
  await db.run("UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE token_hash = ?", [refreshHash]);

  return generateTokenPair(db, clientId, record.tenant_id, record.scopes);
}

/**
 * Revoke a token.
 */
export async function revokeToken(db: DatabaseAdapter, token: string): Promise<void> {
  const tokenHash = await hashToken(token);
  await db.run("UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE token_hash = ?", [tokenHash]);
}

/**
 * Get the PKCE code challenge for an authorization code.
 */
export async function getCodeChallenge(db: DatabaseAdapter, code: string): Promise<string | null> {
  const record = await db.get<{ code_challenge: string | null }>(
    "SELECT code_challenge FROM oauth_codes WHERE code = ? AND used_at IS NULL AND expires_at > ?",
    [code, Date.now()]
  );
  return record?.code_challenge ?? null;
}

/**
 * Verify an access token.
 */
export async function verifyToken(db: DatabaseAdapter, token: string): Promise<AuthInfo> {
  return verifyAccessToken(db, token);
}

// ============================================================================
// Internal
// ============================================================================

async function generateTokenPair(
  db: DatabaseAdapter,
  clientId: string,
  tenantId: string,
  scopes: string | null
): Promise<TokenPair> {
  const accessToken = generateSecureToken();
  const refreshToken = generateSecureToken();
  const accessHash = await hashToken(accessToken);
  const refreshHash = await hashToken(refreshToken);

  await db.batch([
    {
      sql: `INSERT INTO oauth_tokens (token_hash, token_type, client_id, tenant_id, scopes, expires_at)
            VALUES (?, 'access', ?, ?, ?, ?)`,
      params: [accessHash, clientId, tenantId, scopes, Date.now() + ACCESS_TOKEN_TTL_MS],
    },
    {
      sql: `INSERT INTO oauth_tokens (token_hash, token_type, client_id, tenant_id, scopes, expires_at)
            VALUES (?, 'refresh', ?, ?, ?, ?)`,
      params: [refreshHash, clientId, tenantId, scopes, Date.now() + REFRESH_TOKEN_TTL_MS],
    },
  ]);

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: refreshToken,
  };
}

function generateSecureToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute S256 code challenge from a code verifier (RFC 7636).
 * Returns base64url-encoded SHA-256 digest.
 */
async function computeS256Challenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
