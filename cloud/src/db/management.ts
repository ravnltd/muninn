/**
 * Management Database Adapter
 *
 * Single Turso database we own, storing tenant metadata.
 * Uses the same HttpAdapter from muninn core.
 */

import { HttpAdapter, type HttpAdapterConfig, type DatabaseAdapter } from "../types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let instance: DatabaseAdapter | null = null;

function getConfig(): HttpAdapterConfig {
  const url = process.env.MGMT_DB_URL;
  if (!url) throw new Error("MGMT_DB_URL environment variable is required");

  return {
    primaryUrl: url,
    authToken: process.env.MGMT_DB_TOKEN,
    timeout: 10_000,
  };
}

export async function getManagementDb(): Promise<DatabaseAdapter> {
  if (instance) return instance;

  const adapter = new HttpAdapter(getConfig());
  await adapter.init();

  // Check if schema exists, init if needed
  const exists = await checkSchemaExists(adapter);
  if (!exists) {
    const schemaPath = join(import.meta.dir, "schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");
    await adapter.exec(schemaSql);
  }

  instance = adapter;
  return adapter;
}

async function checkSchemaExists(adapter: DatabaseAdapter): Promise<boolean> {
  try {
    await adapter.get("SELECT 1 FROM tenants LIMIT 1");
    return true;
  } catch {
    return false;
  }
}
