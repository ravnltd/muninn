/**
 * Project database connection management.
 *
 * Handles per-project DB path resolution, Drizzle wrappers,
 * and project-level schema init + migrations.
 */

import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseAdapter } from "../adapter.js";
import { LocalAdapter } from "../adapters/local.js";
import { applyReliabilityPragmas, runMigrations } from "../migrations.js";
import {
  GLOBAL_DB_PATH,
  LOCAL_DB_DIR,
  LOCAL_DB_NAME,
  SCHEMA_PATH,
  getConfig,
  getGlobalDb,
  type DrizzleDb,
} from "./global.js";

// ---------------------------------------------------------------------------
// Connection State
// ---------------------------------------------------------------------------

let projectAdapterInstance: DatabaseAdapter | null = null;
let projectDrizzleInstance: DrizzleDb | null = null;
let currentProjectDbPath: string | null = null;

// ---------------------------------------------------------------------------
// Path Resolution
// ---------------------------------------------------------------------------

export function getProjectDbPath(): string {
  let dir = process.cwd();
  while (dir !== "/") {
    const localDb = join(dir, LOCAL_DB_DIR, LOCAL_DB_NAME);
    if (existsSync(localDb)) {
      return localDb;
    }
    dir = resolve(dir, "..");
  }
  return GLOBAL_DB_PATH;
}

// ---------------------------------------------------------------------------
// Project Database
// ---------------------------------------------------------------------------

export async function getProjectDb(): Promise<DatabaseAdapter> {
  // All projects now use the global database.
  // Projects are distinguished by project_id in each table.
  return getGlobalDb();
}

/**
 * Get project database with Drizzle ORM wrapper.
 * Use for type-safe queries.
 * Note: Only works in local mode (Drizzle requires bun:sqlite Database).
 */
export async function getProjectDrizzle(): Promise<DrizzleDb> {
  if (projectDrizzleInstance && currentProjectDbPath === getProjectDbPath()) {
    return projectDrizzleInstance;
  }

  const config = getConfig();
  if (config.mode !== "local") {
    throw new Error("Drizzle ORM only supported in local mode (not available in http mode)");
  }

  // Dynamic imports to avoid loading native modules at startup
  const [{ drizzle }, schema] = await Promise.all([
    import("drizzle-orm/bun-sqlite"),
    import("../schema.js"),
  ]);

  const adapter = await getProjectDb();
  const db = adapter.raw() as Database;
  projectDrizzleInstance = drizzle(db, { schema });
  currentProjectDbPath = getProjectDbPath();
  return projectDrizzleInstance;
}

export async function initProjectDb(path: string): Promise<DatabaseAdapter> {
  const config = getConfig();
  const dir = join(path, LOCAL_DB_DIR);
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }

  const dbPath = join(dir, LOCAL_DB_NAME);

  // Close existing instance if any
  if (projectAdapterInstance) {
    projectAdapterInstance.close();
  }

  // Create adapter based on config
  if (config.mode === "http") {
    if (!config.primaryUrl) {
      throw new Error("HTTP mode requires MUNINN_PRIMARY_URL");
    }

    // HTTP adapter — pure fetch, no native modules
    const { HttpAdapter } = await import("../adapters/http.js");
    projectAdapterInstance = new HttpAdapter({
      primaryUrl: config.primaryUrl,
      authToken: config.authToken,
    });
    await projectAdapterInstance.init();

    // Load and execute schema asynchronously
    if (existsSync(SCHEMA_PATH)) {
      const schema = readFileSync(SCHEMA_PATH, "utf-8");
      await projectAdapterInstance.exec(schema);
    }
  } else {
    // For local mode, use sync operations
    const db = new Database(dbPath);
    applyReliabilityPragmas(db);

    // Load and execute schema
    if (existsSync(SCHEMA_PATH)) {
      const schema = readFileSync(SCHEMA_PATH, "utf-8");
      db.exec(schema);
    }

    // Run migrations to bring to current version
    const migrationResult = runMigrations(db, dbPath);
    if (!migrationResult.ok) {
      console.error(`⚠️  Migration warning: ${migrationResult.error.message}`);
    }

    projectAdapterInstance = new LocalAdapter(db);
  }

  currentProjectDbPath = dbPath;
  return projectAdapterInstance;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function closeProjectDb(): void {
  if (projectAdapterInstance) {
    projectAdapterInstance.close();
    projectAdapterInstance = null;
    projectDrizzleInstance = null;
    currentProjectDbPath = null;
  }
}
