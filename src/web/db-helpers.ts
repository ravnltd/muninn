/**
 * Schema-tolerant query helpers (async, adapter-based).
 * Fall back to simpler queries when columns don't exist yet.
 */

import type { DatabaseAdapter } from "../database/adapter";

export async function safeAll<T>(adapter: DatabaseAdapter, query: string, fallback: string, params: unknown[]): Promise<T[]> {
  try {
    return await adapter.all<T>(query, params);
  } catch {
    return await adapter.all<T>(fallback, params);
  }
}

export async function safeGet<T>(
  adapter: DatabaseAdapter,
  query: string,
  fallback: string,
  params: unknown[],
): Promise<T | null> {
  try {
    return await adapter.get<T>(query, params);
  } catch {
    return await adapter.get<T>(fallback, params);
  }
}
