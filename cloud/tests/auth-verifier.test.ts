/**
 * Tests for dual auth verifier (API key + OAuth token paths).
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { createMockDb, seedTenant } from "./mock-db";
import { verifyAccessToken, AuthError } from "../src/auth/verifier";
import { generateApiKey } from "../src/auth/keys";
import type { DatabaseAdapter } from "../src/types";

let db: DatabaseAdapter;
let tenantId: string;

beforeEach(async () => {
  db = createMockDb();
  const tenant = await seedTenant(db);
  tenantId = tenant.id;
});

// Helper: hash a token the same way the verifier does
async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Helper: insert an OAuth token directly
async function insertOAuthToken(
  db: DatabaseAdapter,
  token: string,
  opts: {
    tenantId: string;
    clientId?: string;
    scopes?: string;
    expiresAt?: number;
    revoked?: boolean;
    tokenType?: string;
  }
): Promise<void> {
  const tokenHash = await hashToken(token);
  await db.run(
    `INSERT INTO oauth_tokens (token_hash, token_type, client_id, tenant_id, scopes, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      tokenHash,
      opts.tokenType ?? "access",
      opts.clientId ?? "test-client",
      opts.tenantId,
      opts.scopes ?? '["mcp:tools"]',
      opts.expiresAt ?? Date.now() + 3600_000,
      opts.revoked ? new Date().toISOString() : null,
    ]
  );
}

describe("verifyAccessToken — API key path", () => {
  test("returns AuthInfo for valid API key", async () => {
    const { key } = await generateApiKey(db, tenantId);
    const info = await verifyAccessToken(db, key);

    expect(info.clientId).toBe(tenantId);
    expect(info.scopes).toEqual(["mcp:tools"]);
    expect(info.extra?.type).toBe("api_key");
  });

  test("throws AuthError for invalid API key", async () => {
    try {
      await verifyAccessToken(db, "mk_0000000000000000000000000000000000000000000000000000000000000000");
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).message).toBe("Invalid or revoked API key");
      expect((error as AuthError).statusCode).toBe(401);
    }
  });

  test("throws AuthError for revoked API key", async () => {
    const { key, record } = await generateApiKey(db, tenantId);
    await db.run("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?", [record.id]);

    try {
      await verifyAccessToken(db, key);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
    }
  });

  test("includes keyId in extra", async () => {
    const { key, record } = await generateApiKey(db, tenantId);
    const info = await verifyAccessToken(db, key);
    expect(info.extra?.keyId).toBe(record.id);
  });
});

describe("verifyAccessToken — OAuth token path", () => {
  test("returns AuthInfo for valid OAuth token", async () => {
    const token = "valid-oauth-token-12345";
    await insertOAuthToken(db, token, { tenantId });

    const info = await verifyAccessToken(db, token);
    expect(info.clientId).toBe(tenantId);
    expect(info.scopes).toEqual(["mcp:tools"]);
    expect(info.extra?.type).toBe("oauth");
  });

  test("returns correct client_id in extra", async () => {
    const token = "oauth-with-client";
    await insertOAuthToken(db, token, { tenantId, clientId: "my-app-client" });

    const info = await verifyAccessToken(db, token);
    expect(info.extra?.clientId).toBe("my-app-client");
  });

  test("throws for non-existent token", async () => {
    try {
      await verifyAccessToken(db, "nonexistent-token");
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).message).toBe("Invalid access token");
    }
  });

  test("throws for revoked token", async () => {
    const token = "revoked-oauth-token";
    await insertOAuthToken(db, token, { tenantId, revoked: true });

    try {
      await verifyAccessToken(db, token);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).message).toBe("Token has been revoked");
    }
  });

  test("throws for expired token", async () => {
    const token = "expired-oauth-token";
    await insertOAuthToken(db, token, { tenantId, expiresAt: Date.now() - 1000 });

    try {
      await verifyAccessToken(db, token);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).message).toBe("Token has expired");
    }
  });

  test("only matches access tokens, not refresh tokens", async () => {
    const token = "refresh-token-only";
    await insertOAuthToken(db, token, { tenantId, tokenType: "refresh" });

    try {
      await verifyAccessToken(db, token);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).message).toBe("Invalid access token");
    }
  });

  test("defaults to mcp:tools scope when scopes are null", async () => {
    const token = "null-scopes-token";
    await insertOAuthToken(db, token, { tenantId, scopes: null as unknown as string });

    // Need to insert with null directly
    const tokenHash = await hashToken(token);
    await db.run("UPDATE oauth_tokens SET scopes = NULL WHERE token_hash = ?", [tokenHash]);

    const info = await verifyAccessToken(db, token);
    expect(info.scopes).toEqual(["mcp:tools"]);
  });
});

describe("AuthError", () => {
  test("defaults to 401 status code", () => {
    const error = new AuthError("test");
    expect(error.statusCode).toBe(401);
    expect(error.name).toBe("AuthError");
  });

  test("accepts custom status code", () => {
    const error = new AuthError("forbidden", 403);
    expect(error.statusCode).toBe(403);
  });

  test("is instanceof Error", () => {
    const error = new AuthError("test");
    expect(error instanceof Error).toBe(true);
  });
});
