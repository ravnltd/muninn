/**
 * Dual Auth Verifier
 *
 * Handles both API key (mk_xxx) and OAuth bearer token verification.
 * Returns AuthInfo for use by the MCP endpoint.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { DatabaseAdapter } from "../types";
import { verifyApiKey } from "./keys";
import { getTenantOwner } from "../rbac/users";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = "AuthError";
  }
}

interface OAuthTokenRecord {
  token_hash: string;
  token_type: string;
  client_id: string;
  tenant_id: string;
  scopes: string | null;
  expires_at: number;
  revoked_at: string | null;
}

/**
 * Verify an access token (API key or OAuth) and return AuthInfo.
 */
export async function verifyAccessToken(db: DatabaseAdapter, token: string): Promise<AuthInfo> {
  // Try API key first (starts with "mk_")
  if (token.startsWith("mk_")) {
    const apiKey = await verifyApiKey(db, token);
    if (!apiKey) throw new AuthError("Invalid or revoked API key");

    const scopes: string[] = JSON.parse(apiKey.scopes);

    // Resolve user_id and role from api_keys or fallback to tenant owner
    const { userId, role } = await resolveUserFromKey(db, apiKey.id, apiKey.tenant_id);

    return {
      token,
      clientId: apiKey.tenant_id,
      scopes,
      extra: { type: "api_key", keyId: apiKey.id, userId, role },
    };
  }

  // Try OAuth token
  const tokenHash = await hashToken(token);
  const oauthToken = await db.get<OAuthTokenRecord>(
    "SELECT * FROM oauth_tokens WHERE token_hash = ? AND token_type = 'access'",
    [tokenHash]
  );

  if (!oauthToken) throw new AuthError("Invalid or expired access token");
  if (oauthToken.revoked_at) throw new AuthError("Invalid or expired access token");
  if (oauthToken.expires_at < Date.now()) throw new AuthError("Invalid or expired access token");

  const scopes = oauthToken.scopes ? JSON.parse(oauthToken.scopes) : ["mcp:tools"];

  // Resolve user_id and role (user_id may be on token if column exists)
  const oauthUserId = (oauthToken as Record<string, unknown>).user_id as string | undefined;
  const { userId, role } = await resolveUserFromOAuth(db, oauthUserId ?? null, oauthToken.tenant_id);

  return {
    token,
    clientId: oauthToken.tenant_id,
    scopes,
    extra: { type: "oauth", clientId: oauthToken.client_id, userId, role },
  };
}

/**
 * Resolve user_id and role from an API key. Falls back to tenant owner
 * for pre-migration keys that don't have user_id set.
 */
async function resolveUserFromKey(
  db: DatabaseAdapter,
  keyId: string,
  tenantId: string
): Promise<{ userId: string; role: string }> {
  try {
    const keyUser = await db.get<{ user_id: string }>(
      "SELECT user_id FROM api_keys WHERE id = ? AND user_id IS NOT NULL",
      [keyId]
    );
    if (keyUser) {
      const user = await db.get<{ role: string }>(
        "SELECT role FROM users WHERE id = ? AND status = 'active'",
        [keyUser.user_id]
      );
      if (user) return { userId: keyUser.user_id, role: user.role };
    }
  } catch {
    // Column might not exist yet
  }

  // Fallback: find tenant owner
  return fallbackToOwner(db, tenantId);
}

/**
 * Resolve user_id and role from an OAuth token.
 */
async function resolveUserFromOAuth(
  db: DatabaseAdapter,
  userId: string | null,
  tenantId: string
): Promise<{ userId: string; role: string }> {
  if (userId) {
    try {
      const user = await db.get<{ role: string }>(
        "SELECT role FROM users WHERE id = ? AND status = 'active'",
        [userId]
      );
      if (user) return { userId, role: user.role };
    } catch {
      // users table might not exist
    }
  }

  return fallbackToOwner(db, tenantId);
}

/**
 * Fallback: resolve tenant owner for backward compatibility.
 */
async function fallbackToOwner(
  db: DatabaseAdapter,
  tenantId: string
): Promise<{ userId: string; role: string }> {
  try {
    const owner = await getTenantOwner(db, tenantId);
    if (owner) return { userId: owner.id, role: "owner" };
  } catch {
    // users table might not exist yet
  }

  // Ultimate fallback: synthesize owner context
  return { userId: tenantId, role: "owner" };
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
