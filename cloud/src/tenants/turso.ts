/**
 * Turso Platform API Client
 *
 * Provisions and manages per-tenant databases on Turso.
 */

const TURSO_API = "https://api.turso.tech/v1";

interface TursoConfig {
  org: string;
  token: string;
}

export interface ProvisionedDatabase {
  name: string;
  url: string;
  authToken: string;
  exportToken: string;
}

function getConfig(): TursoConfig {
  const org = process.env.TURSO_ORG;
  const token = process.env.TURSO_API_TOKEN;
  if (!org || !token) throw new Error("TURSO_ORG and TURSO_API_TOKEN are required");
  return { org, token };
}

async function tursoFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const config = getConfig();
  const url = `${TURSO_API}/organizations/${config.org}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Turso API error ${res.status}: ${body}`);
  }

  return res;
}

/**
 * Provision a new Turso database for a tenant.
 */
export async function provisionDatabase(tenantId: string): Promise<ProvisionedDatabase> {
  const dbName = `muninn-${tenantId.slice(0, 8)}`;

  // Create database
  const createRes = await tursoFetch("/databases", {
    method: "POST",
    body: JSON.stringify({ name: dbName, group: "default" }),
  });
  const { database } = (await createRes.json()) as { database: { Hostname: string } };
  const dbUrl = `https://${database.Hostname}`;

  // Generate full-access token
  const tokenRes = await tursoFetch(`/databases/${dbName}/auth/tokens`, {
    method: "POST",
    body: JSON.stringify({ expiration: "never", authorization: "full-access" }),
  });
  const { jwt: authToken } = (await tokenRes.json()) as { jwt: string };

  // Generate read-only export token
  const exportRes = await tursoFetch(`/databases/${dbName}/auth/tokens`, {
    method: "POST",
    body: JSON.stringify({ expiration: "never", authorization: "read-only" }),
  });
  const { jwt: exportToken } = (await exportRes.json()) as { jwt: string };

  return { name: dbName, url: dbUrl, authToken, exportToken };
}

/**
 * Delete a tenant's Turso database.
 */
export async function deleteDatabase(dbName: string): Promise<void> {
  await tursoFetch(`/databases/${dbName}`, { method: "DELETE" });
}
