/**
 * API Key Authentication Middleware
 *
 * Verifies Bearer tokens against pre-configured API keys.
 * Keys are loaded from API_KEYS env var (comma-separated).
 * Each key is stored as SHA-256 hash for timing-safe comparison.
 *
 * Also extracts X-Muninn-App header for app identification.
 */

import type { Context, Next } from "hono";
import type { ApiEnv } from "../types";

interface KeyEntry {
  hash: string;
  tenantId: string;
}

let keyStore: KeyEntry[] | null = null;

/**
 * Hash an API key using SHA-256.
 */
async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Initialize the key store from API_KEYS env var.
 * Format: "mk_key1,mk_key2" or "tenant1:mk_key1,tenant2:mk_key2"
 */
async function getKeyStore(): Promise<KeyEntry[]> {
  if (keyStore) return keyStore;

  const raw = process.env.API_KEYS ?? "";
  if (!raw) {
    keyStore = [];
    return keyStore;
  }

  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const store: KeyEntry[] = [];

  for (const entry of entries) {
    const colonIdx = entry.indexOf(":");
    // Check if this is "tenantId:mk_key" format (colon before mk_ prefix)
    if (colonIdx > 0 && entry.substring(colonIdx + 1).startsWith("mk_")) {
      const tenantId = entry.substring(0, colonIdx);
      const key = entry.substring(colonIdx + 1);
      store.push({ hash: await hashKey(key), tenantId });
    } else {
      // Plain key, use "default" tenant
      store.push({ hash: await hashKey(entry), tenantId: "default" });
    }
  }

  keyStore = store;
  return keyStore;
}

/**
 * Timing-safe string comparison to prevent side-channel attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

/**
 * Verify a bearer token. Returns tenant ID or null.
 * Uses timing-safe comparison to prevent side-channel attacks.
 */
async function verifyToken(token: string): Promise<string | null> {
  const store = await getKeyStore();
  if (store.length === 0) return null;

  const tokenHash = await hashKey(token);

  for (const entry of store) {
    if (timingSafeEqual(tokenHash, entry.hash)) {
      return entry.tenantId;
    }
  }

  return null;
}

/**
 * Auth middleware for Hono. Requires:
 * - Authorization: Bearer mk_xxx header
 * - X-Muninn-App header
 */
export function authMiddleware() {
  return async (c: Context<ApiEnv>, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { error: "Missing Authorization header. Use: Authorization: Bearer mk_xxx" },
        401
      );
    }

    const token = authHeader.slice(7);
    const tenantId = await verifyToken(token);

    if (!tenantId) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    const appId = c.req.header("X-Muninn-App");
    if (!appId) {
      return c.json(
        { error: "Missing X-Muninn-App header. Specify the app ID (e.g. huginn, studio)" },
        400
      );
    }

    c.set("tenantId", tenantId);
    c.set("appId", appId);

    return next();
  };
}

/**
 * Reset key store (for testing).
 */
export function resetKeyStore(): void {
  keyStore = null;
}
