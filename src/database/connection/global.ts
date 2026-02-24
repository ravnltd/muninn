/**
 * Global database connection management.
 *
 * Exports the shared config, path constants, and global DB singleton.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { loadConfig } from "../../config/index.js";
import type { DatabaseAdapter } from "../adapter.js";
import { LocalAdapter } from "../adapters/local.js";
import {
  applyReliabilityPragmas,
  checkIntegrity,
  getLatestVersion,
  getSchemaVersion,
  type IntegrityCheck,
  logDbError,
  type MigrationState,
} from "../migrations.js";
import {
  getMuninnHome,
  getGlobalDbPath as resolveGlobalDbPath,
  getProjectDataDir,
  getSchemaPath as resolveSchemaPath,
} from "../../paths.js";
import { checkSchemaExists, initGlobalTables, initGlobalTablesAsync } from "./schema-init.js";
import { repairFtsIssues } from "./repair.js";

// ---------------------------------------------------------------------------
// Schema is lazy-loaded to avoid pulling in drizzle-orm at startup.
// This prevents native module loading in HTTP mode.
// ---------------------------------------------------------------------------
type SchemaType = typeof import("../schema");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const GLOBAL_DB_PATH = resolveGlobalDbPath();
export const LOCAL_DB_DIR = getProjectDataDir();
export const LOCAL_DB_NAME = "memory.db";
export const SCHEMA_PATH = resolveSchemaPath();

// Re-export migration utilities for external use
export { getSchemaVersion, getLatestVersion, checkIntegrity, logDbError };
export type { MigrationState, IntegrityCheck };

// Re-export schema for direct imports (lazy — only loads when accessed)
export * from "../schema.js";

// ---------------------------------------------------------------------------
// Type Exports
// ---------------------------------------------------------------------------

export type DrizzleDb = BunSQLiteDatabase<SchemaType>;

// ---------------------------------------------------------------------------
// Connection State
// ---------------------------------------------------------------------------

let globalAdapterInstance: DatabaseAdapter | null = null;
let globalDrizzleInstance: DrizzleDb | null = null;

// Load config once at module level
const config = loadConfig();

/** Export config getter for network commands. */
export function getConfig() {
  return config;
}

// ---------------------------------------------------------------------------
// Global Database
// ---------------------------------------------------------------------------

export async function getGlobalDb(): Promise<DatabaseAdapter> {
  if (globalAdapterInstance) {
    return globalAdapterInstance;
  }

  const dir = getMuninnHome();
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }

  // Create adapter based on config
  if (config.mode === "http") {
    if (!config.primaryUrl) {
      throw new Error("HTTP mode requires MUNINN_PRIMARY_URL");
    }
    // HTTP adapter — pure fetch, no native modules
    const { HttpAdapter } = await import("../adapters/http.js");
    globalAdapterInstance = new HttpAdapter({
      primaryUrl: config.primaryUrl,
      authToken: config.authToken,
    });
    await globalAdapterInstance.init();
  } else {
    const db = new Database(GLOBAL_DB_PATH);
    applyReliabilityPragmas(db);
    globalAdapterInstance = new LocalAdapter(db);
  }

  // Ensure global tables exist (use raw DB for schema init)
  if (config.mode === "local") {
    const rawDb = globalAdapterInstance.raw() as Database;
    initGlobalTables(rawDb);
  } else {
    // For HTTP mode, skip init if schema already exists (fast path)
    const schemaExists = await checkSchemaExists(globalAdapterInstance);
    if (!schemaExists) {
      await initGlobalTablesAsync(globalAdapterInstance);
    }
  }

  // Repair fts_issues if it was created with wrong columns (missing workaround/resolution)
  await repairFtsIssues(globalAdapterInstance);

  return globalAdapterInstance;
}

/**
 * Get global database with Drizzle ORM wrapper.
 * Use for type-safe queries.
 * Note: Only works in local mode (Drizzle requires bun:sqlite Database).
 */
export async function getGlobalDrizzle(): Promise<DrizzleDb> {
  if (globalDrizzleInstance) {
    return globalDrizzleInstance;
  }

  if (config.mode !== "local") {
    throw new Error("Drizzle ORM only supported in local mode (not available in http mode)");
  }

  // Dynamic imports to avoid loading native modules at startup
  const [{ drizzle }, schema] = await Promise.all([
    import("drizzle-orm/bun-sqlite"),
    import("../schema.js"),
  ]);

  const adapter = await getGlobalDb();
  const db = adapter.raw() as Database;
  globalDrizzleInstance = drizzle(db, { schema });
  return globalDrizzleInstance;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function closeGlobalDb(): void {
  if (globalAdapterInstance) {
    globalAdapterInstance.close();
    globalAdapterInstance = null;
    globalDrizzleInstance = null;
  }
}
