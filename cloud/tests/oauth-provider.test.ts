/**
 * Tests for OAuth provider: authorization codes, token exchange, revocation.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { createMockDb, seedTenant } from "./mock-db";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  revokeToken,
  getCodeChallenge,
} from "../src/auth/provider";
import type { DatabaseAdapter } from "../src/types";

let db: DatabaseAdapter;
let tenantId: string;

beforeEach(async () => {
  db = createMockDb();
  const tenant = await seedTenant(db);
  tenantId = tenant.id;
});

describe("createAuthorizationCode", () => {
  test("returns a non-empty code", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "challenge123", ["mcp:tools"]
    );
    expect(code.length).toBeGreaterThan(0);
  });

  test("stores code in database", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "challenge123", null
    );
    const record = await db.get<{ code: string }>("SELECT code FROM oauth_codes WHERE code = ?", [code]);
    expect(record).not.toBeNull();
  });

  test("stores PKCE code challenge", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "my-challenge", null
    );
    const record = await db.get<{ code_challenge: string }>(
      "SELECT code_challenge FROM oauth_codes WHERE code = ?", [code]
    );
    expect(record!.code_challenge).toBe("my-challenge");
  });

  test("generates unique codes", async () => {
    const code1 = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "c1", null
    );
    const code2 = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "c2", null
    );
    expect(code1).not.toBe(code2);
  });
});

describe("getCodeChallenge", () => {
  test("returns challenge for valid code", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "my-challenge", null
    );
    const challenge = await getCodeChallenge(db, code);
    expect(challenge).toBe("my-challenge");
  });

  test("returns null for non-existent code", async () => {
    const challenge = await getCodeChallenge(db, "nonexistent");
    expect(challenge).toBeNull();
  });

  test("returns null for used code", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "challenge", null
    );
    // Mark as used
    await db.run("UPDATE oauth_codes SET used_at = datetime('now') WHERE code = ?", [code]);
    const challenge = await getCodeChallenge(db, code);
    expect(challenge).toBeNull();
  });

  test("returns null for expired code", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "challenge", null
    );
    // Expire it
    await db.run("UPDATE oauth_codes SET expires_at = ? WHERE code = ?", [Date.now() - 1000, code]);
    const challenge = await getCodeChallenge(db, code);
    expect(challenge).toBeNull();
  });
});

describe("exchangeAuthorizationCode", () => {
  test("returns token pair (no PKCE)", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", ["mcp:tools"]
    );

    const tokens = await exchangeAuthorizationCode(db, "client-1", code);
    expect(tokens.access_token.length).toBeGreaterThan(0);
    expect(tokens.refresh_token.length).toBeGreaterThan(0);
    expect(tokens.token_type).toBe("bearer");
    expect(tokens.expires_in).toBe(3600);
  });

  test("marks code as used", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", null
    );
    await exchangeAuthorizationCode(db, "client-1", code);

    const record = await db.get<{ used_at: string | null }>(
      "SELECT used_at FROM oauth_codes WHERE code = ?", [code]
    );
    expect(record!.used_at).not.toBeNull();
  });

  test("cannot reuse code", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", null
    );
    await exchangeAuthorizationCode(db, "client-1", code);

    try {
      await exchangeAuthorizationCode(db, "client-1", code);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("Invalid or expired authorization code");
    }
  });

  test("rejects wrong client_id", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", null
    );

    try {
      await exchangeAuthorizationCode(db, "wrong-client", code);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("Invalid or expired authorization code");
    }
  });

  test("stores access and refresh tokens in DB", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", null
    );
    await exchangeAuthorizationCode(db, "client-1", code);

    const tokens = await db.all<{ token_type: string }>(
      "SELECT token_type FROM oauth_tokens WHERE tenant_id = ?", [tenantId]
    );
    const types = tokens.map((t) => t.token_type).sort();
    expect(types).toEqual(["access", "refresh"]);
  });

  test("access and refresh tokens are different", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", null
    );
    const tokens = await exchangeAuthorizationCode(db, "client-1", code);
    expect(tokens.access_token).not.toBe(tokens.refresh_token);
  });

  test("rejects mismatched redirect_uri", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", null
    );

    try {
      await exchangeAuthorizationCode(db, "client-1", code, undefined, "https://evil.com/steal");
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("redirect_uri mismatch");
    }
  });

  test("accepts matching redirect_uri", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", ["mcp:tools"]
    );
    const tokens = await exchangeAuthorizationCode(db, "client-1", code, undefined, "https://example.com/callback");
    expect(tokens.access_token.length).toBeGreaterThan(0);
  });

  test("PKCE: rejects missing code_verifier when challenge is set", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "some-challenge", null
    );

    try {
      await exchangeAuthorizationCode(db, "client-1", code);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("code_verifier required for PKCE");
    }
  });

  test("PKCE: rejects invalid code_verifier", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "valid-challenge", null
    );

    try {
      await exchangeAuthorizationCode(db, "client-1", code, "wrong-verifier");
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("Invalid code_verifier");
    }
  });
});

describe("exchangeRefreshToken", () => {
  async function getTokenPair() {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", null
    );
    return exchangeAuthorizationCode(db, "client-1", code);
  }

  test("returns new token pair", async () => {
    const original = await getTokenPair();
    const refreshed = await exchangeRefreshToken(db, "client-1", original.refresh_token);

    expect(refreshed.access_token.length).toBeGreaterThan(0);
    expect(refreshed.refresh_token.length).toBeGreaterThan(0);
    expect(refreshed.token_type).toBe("bearer");
  });

  test("new tokens differ from original", async () => {
    const original = await getTokenPair();
    const refreshed = await exchangeRefreshToken(db, "client-1", original.refresh_token);

    expect(refreshed.access_token).not.toBe(original.access_token);
    expect(refreshed.refresh_token).not.toBe(original.refresh_token);
  });

  test("revokes old refresh token (rotation)", async () => {
    const original = await getTokenPair();
    await exchangeRefreshToken(db, "client-1", original.refresh_token);

    // Old refresh token should be revoked — cannot use again
    try {
      await exchangeRefreshToken(db, "client-1", original.refresh_token);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("Invalid or expired refresh token");
    }
  });

  test("rejects wrong client_id", async () => {
    const original = await getTokenPair();

    try {
      await exchangeRefreshToken(db, "wrong-client", original.refresh_token);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("Invalid or expired refresh token");
    }
  });

  test("rejects non-existent token", async () => {
    try {
      await exchangeRefreshToken(db, "client-1", "nonexistent-refresh-token");
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBe("Invalid or expired refresh token");
    }
  });
});

describe("revokeToken", () => {
  test("revokes an access token", async () => {
    const code = await createAuthorizationCode(
      db, "client-1", tenantId, "https://example.com/callback", "", null
    );
    const tokens = await exchangeAuthorizationCode(db, "client-1", code);

    await revokeToken(db, tokens.access_token);

    // Check it's marked as revoked
    const all = await db.all<{ revoked_at: string | null; token_type: string }>(
      "SELECT revoked_at, token_type FROM oauth_tokens WHERE tenant_id = ?", [tenantId]
    );
    const accessToken = all.find((t) => t.token_type === "access");
    expect(accessToken!.revoked_at).not.toBeNull();
  });

  test("does not throw for non-existent token", async () => {
    // Should be a no-op, not throw
    await revokeToken(db, "nonexistent-token");
  });
});
