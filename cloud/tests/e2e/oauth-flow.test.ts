/**
 * E2E: OAuth Flow
 *
 * Tests the full OAuth2 authorization code flow with PKCE:
 * register client -> authorize -> exchange code -> use access token -> refresh -> revoke.
 *
 * Uses the full Hono app (server.ts equivalent) with mocked DB and provisioning.
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockDb } from "../mock-db";
import type { DatabaseAdapter } from "../../src/types";

let db: DatabaseAdapter;

// Mock management DB
mock.module("../../src/db/management", () => ({
  getManagementDb: async () => db,
}));

// Mock Turso provisioning
mock.module("../../src/tenants/turso", () => ({
  provisionDatabase: async (tenantId: string) => ({
    name: `muninn-${tenantId.slice(0, 8)}`,
    url: `https://muninn-${tenantId.slice(0, 8)}.turso.io`,
    authToken: "mock-token",
    exportToken: "mock-export",
  }),
  deleteDatabase: async () => {},
}));

// Mock pool
mock.module("../../src/tenants/pool", () => ({
  evictTenant: () => {},
  setManagementDb: () => {},
  getPoolStats: () => ({ size: 0, maxSize: 200 }),
  getTenantDb: async () => db,
}));

const { api } = await import("../../src/api/routes");
const { authRoutes } = await import("../../src/auth/routes");

// Build a test app mirroring server.ts route structure
const app = new Hono();
app.route("/auth", authRoutes);
app.route("/api", api);

beforeEach(() => {
  db = createMockDb();
});

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost${path}`, init);
}

async function formRequest(
  path: string,
  formData: Record<string, string>,
  headers?: Record<string, string>
) {
  const body = new URLSearchParams(formData).toString();
  return app.request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });
}

/**
 * Compute S256 code challenge from a verifier (same algorithm as provider.ts).
 */
async function computeS256Challenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Sign up a test user and return their credentials.
 */
async function createTestUser(email = "oauth-user@example.com", password = "oauthpass123") {
  const res = await apiRequest("POST", "/api/signup", { email, password, name: "OAuth Tester" });
  return res.json();
}

describe("E2E: OAuth Flow", () => {
  describe("POST /auth/register — Dynamic Client Registration", () => {
    test("registers a new OAuth client", async () => {
      const res = await apiRequest("POST", "/auth/register", {
        redirect_uris: ["https://myapp.example.com/callback"],
        client_name: "Test App",
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.client_id).toBeDefined();
      expect(body.client_secret).toBeDefined();
      expect(body.client_secret.startsWith("cs_")).toBe(true);
      expect(body.redirect_uris).toEqual(["https://myapp.example.com/callback"]);
      expect(body.client_name).toBe("Test App");
      expect(body.grant_types).toContain("authorization_code");
      expect(body.grant_types).toContain("refresh_token");
    });

    test("rejects registration without redirect_uris", async () => {
      const res = await apiRequest("POST", "/auth/register", {
        client_name: "No Redirects",
      });
      expect(res.status).toBe(400);
    });

    test("rejects registration with invalid redirect_uri", async () => {
      const res = await apiRequest("POST", "/auth/register", {
        redirect_uris: ["not-a-url"],
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /auth/authorize — Authorization Page", () => {
    test("returns login page with CSRF token", async () => {
      // Register a client first
      const clientRes = await apiRequest("POST", "/auth/register", {
        redirect_uris: ["https://myapp.example.com/callback"],
        client_name: "Auth Test",
      });
      const client = await clientRes.json();

      // Request the authorization page
      const params = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://myapp.example.com/callback",
        response_type: "code",
        scope: "mcp:tools",
      });

      const res = await app.request(
        `http://localhost/auth/authorize?${params.toString()}`,
        { method: "GET" }
      );
      expect(res.status).toBe(200);

      const html = await res.text();
      expect(html).toContain("Sign in");
      expect(html).toContain("_csrf");
      expect(html).toContain(client.client_id);
    });

    test("rejects missing client_id", async () => {
      const params = new URLSearchParams({
        redirect_uri: "https://example.com/callback",
      });
      const res = await app.request(
        `http://localhost/auth/authorize?${params.toString()}`,
        { method: "GET" }
      );
      expect(res.status).toBe(400);
    });

    test("rejects unknown client_id", async () => {
      const params = new URLSearchParams({
        client_id: "nonexistent-client",
        redirect_uri: "https://example.com/callback",
      });
      const res = await app.request(
        `http://localhost/auth/authorize?${params.toString()}`,
        { method: "GET" }
      );
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Unknown client_id");
    });

    test("rejects unregistered redirect_uri", async () => {
      const clientRes = await apiRequest("POST", "/auth/register", {
        redirect_uris: ["https://legit.example.com/callback"],
      });
      const client = await clientRes.json();

      const params = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://evil.example.com/steal",
      });
      const res = await app.request(
        `http://localhost/auth/authorize?${params.toString()}`,
        { method: "GET" }
      );
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("redirect_uri not registered");
    });
  });

  describe("Full OAuth authorization code flow", () => {
    test("complete flow: register -> authorize -> token -> use -> refresh -> revoke", async () => {
      // Step 1: Create a user
      const user = await createTestUser();

      // Step 2: Register OAuth client
      const clientRes = await apiRequest("POST", "/auth/register", {
        redirect_uris: ["https://myapp.example.com/callback"],
        client_name: "Full Flow Test",
      });
      expect(clientRes.status).toBe(201);
      const client = await clientRes.json();

      // Step 3: Get authorization page (to extract CSRF token)
      const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const codeChallenge = await computeS256Challenge(codeVerifier);

      const authPageParams = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://myapp.example.com/callback",
        response_type: "code",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state: "random-state-123",
        scope: "mcp:tools",
      });

      const authPageRes = await app.request(
        `http://localhost/auth/authorize?${authPageParams.toString()}`,
        { method: "GET" }
      );
      expect(authPageRes.status).toBe(200);

      // Extract CSRF token from the HTML
      const html = await authPageRes.text();
      const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();
      const csrfToken = csrfMatch![1];

      // Step 4: Submit authorization form (login + consent)
      const authorizeRes = await formRequest("/auth/authorize", {
        email: "oauth-user@example.com",
        password: "oauthpass123",
        client_id: client.client_id,
        redirect_uri: "https://myapp.example.com/callback",
        state: "random-state-123",
        code_challenge: codeChallenge,
        scope: "mcp:tools",
        _csrf: csrfToken,
      });

      // Should redirect with authorization code
      expect(authorizeRes.status).toBe(302);
      const location = authorizeRes.headers.get("Location");
      expect(location).toBeDefined();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.hostname).toBe("myapp.example.com");
      expect(redirectUrl.searchParams.get("state")).toBe("random-state-123");

      const authCode = redirectUrl.searchParams.get("code");
      expect(authCode).toBeDefined();
      expect(authCode!.length).toBeGreaterThan(0);

      // Step 5: Exchange code for tokens
      const tokenRes = await apiRequest("POST", "/auth/token", {
        grant_type: "authorization_code",
        code: authCode,
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: "https://myapp.example.com/callback",
        code_verifier: codeVerifier,
      });
      expect(tokenRes.status).toBe(200);

      const tokens = await tokenRes.json();
      expect(tokens.access_token).toBeDefined();
      expect(tokens.access_token.length).toBeGreaterThan(0);
      expect(tokens.refresh_token).toBeDefined();
      expect(tokens.refresh_token.length).toBeGreaterThan(0);
      expect(tokens.token_type).toBe("bearer");
      expect(tokens.expires_in).toBe(3600);

      // Step 6: Verify access token works for API access
      const accountRes = await apiRequest("GET", "/api/account", undefined, {
        Authorization: `Bearer ${tokens.access_token}`,
      });
      expect(accountRes.status).toBe(200);

      const accountBody = await accountRes.json();
      expect(accountBody.tenant.email).toBe("oauth-user@example.com");

      // Step 7: Refresh the token
      const refreshRes = await apiRequest("POST", "/auth/token", {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
        client_secret: client.client_secret,
      });
      expect(refreshRes.status).toBe(200);

      const newTokens = await refreshRes.json();
      expect(newTokens.access_token).toBeDefined();
      expect(newTokens.refresh_token).toBeDefined();
      expect(newTokens.access_token).not.toBe(tokens.access_token);
      expect(newTokens.refresh_token).not.toBe(tokens.refresh_token);

      // Step 8: Old refresh token should be revoked (rotation)
      const oldRefreshRes = await apiRequest("POST", "/auth/token", {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
        client_secret: client.client_secret,
      });
      expect(oldRefreshRes.status).toBe(400);

      // Step 9: Revoke the new access token
      const revokeRes = await apiRequest("POST", "/auth/revoke", {
        token: newTokens.access_token,
      });
      expect(revokeRes.status).toBe(200);

      // Step 10: Revoked token should no longer work
      const postRevokeRes = await apiRequest("GET", "/api/account", undefined, {
        Authorization: `Bearer ${newTokens.access_token}`,
      });
      expect(postRevokeRes.status).toBe(401);
    });

    test("authorization code cannot be reused", async () => {
      const user = await createTestUser("reuse@example.com", "password123");

      const clientRes = await apiRequest("POST", "/auth/register", {
        redirect_uris: ["https://app.example.com/cb"],
      });
      const client = await clientRes.json();

      // Get auth page and CSRF
      const authParams = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://app.example.com/cb",
        response_type: "code",
      });
      const authPage = await app.request(
        `http://localhost/auth/authorize?${authParams.toString()}`,
        { method: "GET" }
      );
      const pageHtml = await authPage.text();
      const csrf = pageHtml.match(/name="_csrf"\s+value="([^"]+)"/)![1];

      // Submit authorization
      const authorizeRes = await formRequest("/auth/authorize", {
        email: "reuse@example.com",
        password: "password123",
        client_id: client.client_id,
        redirect_uri: "https://app.example.com/cb",
        _csrf: csrf,
      });
      const redirectUrl = new URL(authorizeRes.headers.get("Location")!);
      const code = redirectUrl.searchParams.get("code")!;

      // First exchange succeeds
      const firstExchange = await apiRequest("POST", "/auth/token", {
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        client_secret: client.client_secret,
      });
      expect(firstExchange.status).toBe(200);

      // Second exchange with same code fails
      const secondExchange = await apiRequest("POST", "/auth/token", {
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        client_secret: client.client_secret,
      });
      expect(secondExchange.status).toBe(400);

      const errorBody = await secondExchange.json();
      expect(errorBody.error).toBe("invalid_grant");
    });

    test("wrong credentials during authorization shows error page", async () => {
      await createTestUser("wrongpw@example.com", "correctpassword");

      const clientRes = await apiRequest("POST", "/auth/register", {
        redirect_uris: ["https://app.example.com/cb"],
      });
      const client = await clientRes.json();

      const authParams = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://app.example.com/cb",
      });
      const authPage = await app.request(
        `http://localhost/auth/authorize?${authParams.toString()}`,
        { method: "GET" }
      );
      const pageHtml = await authPage.text();
      const csrf = pageHtml.match(/name="_csrf"\s+value="([^"]+)"/)![1];

      const authorizeRes = await formRequest("/auth/authorize", {
        email: "wrongpw@example.com",
        password: "wrongpassword",
        client_id: client.client_id,
        redirect_uri: "https://app.example.com/cb",
        _csrf: csrf,
      });

      // Should re-render the login page with error, not redirect
      expect(authorizeRes.status).toBe(200);
      const errorHtml = await authorizeRes.text();
      expect(errorHtml).toContain("Invalid email or password");
    });
  });

  describe("POST /auth/token — edge cases", () => {
    test("rejects invalid grant_type", async () => {
      const res = await apiRequest("POST", "/auth/token", {
        grant_type: "password",
        username: "test@example.com",
        password: "test123",
      });
      expect(res.status).toBe(400);
    });

    test("rejects unknown client_id", async () => {
      const res = await apiRequest("POST", "/auth/token", {
        grant_type: "authorization_code",
        code: "fake-code",
        client_id: "nonexistent-client",
      });
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error).toBe("invalid_client");
    });
  });

  describe("POST /auth/revoke — Token Revocation", () => {
    test("returns 200 even for non-existent token (RFC 7009)", async () => {
      const res = await apiRequest("POST", "/auth/revoke", {
        token: "nonexistent-token-value",
      });
      expect(res.status).toBe(200);
    });

    test("rejects missing token parameter", async () => {
      const res = await apiRequest("POST", "/auth/revoke", {});
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe("invalid_request");
    });

    test("accepts form-encoded body", async () => {
      const res = await formRequest("/auth/revoke", {
        token: "some-token-value",
      });
      expect(res.status).toBe(200);
    });
  });
});
