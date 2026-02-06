/**
 * OAuth Client Store (Phase 2)
 *
 * DB-backed client registration for Dynamic Client Registration (RFC 7591).
 * Standalone implementation (not tied to MCP SDK's Express-dependent interface).
 */

import { timingSafeEqual as nodeTimingSafeEqual } from "crypto";
import type { DatabaseAdapter } from "../types";

export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  grant_types: string[];
}

interface ClientRecord {
  client_id: string;
  client_secret_hash: string | null;
  tenant_id: string | null;
  redirect_uris: string;
  client_name: string | null;
  grant_types: string;
}

export class ClientsStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async getClient(clientId: string): Promise<OAuthClient | null> {
    const record = await this.db.get<ClientRecord>(
      "SELECT * FROM oauth_clients WHERE client_id = ?",
      [clientId]
    );
    if (!record) return null;

    return {
      client_id: record.client_id,
      redirect_uris: JSON.parse(record.redirect_uris),
      client_name: record.client_name ?? undefined,
      grant_types: JSON.parse(record.grant_types),
    };
  }

  async registerClient(
    redirectUris: string[],
    clientName?: string,
    grantTypes?: string[]
  ): Promise<OAuthClient & { client_secret: string }> {
    const clientId = crypto.randomUUID();
    const clientSecret = generateClientSecret();
    const clientSecretHash = await hashSecret(clientSecret);

    await this.db.run(
      `INSERT INTO oauth_clients (client_id, client_secret_hash, redirect_uris, client_name, grant_types)
       VALUES (?, ?, ?, ?, ?)`,
      [
        clientId,
        clientSecretHash,
        JSON.stringify(redirectUris),
        clientName ?? null,
        JSON.stringify(grantTypes ?? ["authorization_code", "refresh_token"]),
      ]
    );

    return {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      client_name: clientName,
      grant_types: grantTypes ?? ["authorization_code", "refresh_token"],
    };
  }

  async verifyClientSecret(clientId: string, clientSecret: string): Promise<boolean> {
    const record = await this.db.get<{ client_secret_hash: string | null }>(
      "SELECT client_secret_hash FROM oauth_clients WHERE client_id = ?",
      [clientId]
    );
    // Always compute hash to prevent timing oracle on client existence
    const hash = await hashSecret(clientSecret);
    if (!record || !record.client_secret_hash) return false;
    return timingSafeEqual(hash, record.client_secret_hash);
  }

  async hasClientSecret(clientId: string): Promise<boolean> {
    const record = await this.db.get<{ client_secret_hash: string | null }>(
      "SELECT client_secret_hash FROM oauth_clients WHERE client_id = ?",
      [clientId]
    );
    return record !== null && record.client_secret_hash !== null;
  }

  async bindClientToTenant(clientId: string, tenantId: string): Promise<void> {
    await this.db.run(
      "UPDATE oauth_clients SET tenant_id = ? WHERE client_id = ?",
      [tenantId, clientId]
    );
  }
}

function generateClientSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `cs_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function hashSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return nodeTimingSafeEqual(bufA, bufB);
}
