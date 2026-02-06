/**
 * Dual Auth Verifier
 *
 * Handles both API key (mk_xxx) and OAuth bearer token verification.
 * Returns AuthInfo for use by the MCP endpoint.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { DatabaseAdapter } from "../types";
import { verifyApiKey } from "./keys";

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
    return {
      token,
      clientId: apiKey.tenant_id,
      scopes,
      extra: { type: "api_key", keyId: apiKey.id },
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
  return {
    token,
    clientId: oauthToken.tenant_id,
    scopes,
    extra: { type: "oauth", clientId: oauthToken.client_id },
  };
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
