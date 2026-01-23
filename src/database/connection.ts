/**
 * Database connection management
 * Singleton pattern for global and project databases
 *
 * Features:
 * - Automatic schema migrations on connection
 * - Reliability pragmas (busy_timeout, WAL, etc.)
 * - Connection caching with proper cleanup
 * - Integrity checking
 * - Drizzle ORM support for type-safe queries
 */

import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
  runMigrations,
  applyReliabilityPragmas,
  getSchemaVersion,
  getLatestVersion,
  checkIntegrity,
  logDbError,
  type MigrationState,
  type IntegrityCheck,
} from "./migrations";

// ============================================================================
// Configuration
// ============================================================================

export const GLOBAL_DB_PATH = join(process.env.HOME || "~", ".claude", "memory.db");
export const LOCAL_DB_DIR = ".claude";
export const LOCAL_DB_NAME = "memory.db";
export const SCHEMA_PATH = join(process.env.HOME || "~", ".claude", "schema.sql");

// Re-export migration utilities for external use
export { getSchemaVersion, getLatestVersion, checkIntegrity, logDbError };
export type { MigrationState, IntegrityCheck };

// Re-export schema for direct imports
export * from "./schema";

// ============================================================================
// Type Exports
// ============================================================================

export type DrizzleDb = BunSQLiteDatabase<typeof schema>;

// ============================================================================
// Connection State
// ============================================================================

let globalDbInstance: Database | null = null;
let globalDrizzleInstance: DrizzleDb | null = null;
let projectDbInstance: Database | null = null;
let projectDrizzleInstance: DrizzleDb | null = null;
let currentProjectDbPath: string | null = null;

// ============================================================================
// Global Database
// ============================================================================

export function getGlobalDb(): Database {
  if (globalDbInstance) {
    return globalDbInstance;
  }

  const dir = join(process.env.HOME || "~", ".claude");
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }

  globalDbInstance = new Database(GLOBAL_DB_PATH);

  // Apply reliability pragmas (busy_timeout, WAL, etc.)
  applyReliabilityPragmas(globalDbInstance);

  // Ensure global tables exist
  initGlobalTables(globalDbInstance);

  return globalDbInstance;
}

/**
 * Get global database with Drizzle ORM wrapper
 * Use for type-safe queries
 */
export function getGlobalDrizzle(): DrizzleDb {
  if (globalDrizzleInstance) {
    return globalDrizzleInstance;
  }

  const db = getGlobalDb();
  globalDrizzleInstance = drizzle(db, { schema });
  return globalDrizzleInstance;
}

function initGlobalTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      source_project TEXT,
      confidence INTEGER DEFAULT 5,
      times_applied INTEGER DEFAULT 0,
      last_applied DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      code_example TEXT,
      anti_pattern TEXT,
      applies_to TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quality_standards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT DEFAULT 'warning',
      auto_fixable INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tech_debt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      severity INTEGER DEFAULT 5,
      effort TEXT,
      affected_files TEXT,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ship_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      version TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      checks_passed TEXT,
      checks_failed TEXT,
      notes TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_patterns USING fts5(
      name, description, code_example
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_global_learnings USING fts5(
      title, content, context
    );

    -- Global observations
    CREATE TABLE IF NOT EXISTS global_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'insight',
      content TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      source_project TEXT,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Global open questions
    CREATE TABLE IF NOT EXISTS global_open_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      context TEXT,
      priority INTEGER DEFAULT 3,
      status TEXT DEFAULT 'open',
      resolution TEXT,
      source_project TEXT,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Global workflow patterns
    CREATE TABLE IF NOT EXISTS global_workflow_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL UNIQUE,
      approach TEXT NOT NULL,
      preferences TEXT,
      examples TEXT,
      times_used INTEGER DEFAULT 1,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Infrastructure tables
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      hostname TEXT,
      ip_addresses TEXT,
      role TEXT,
      ssh_user TEXT DEFAULT 'root',
      ssh_port INTEGER DEFAULT 22,
      ssh_key_path TEXT,
      ssh_jump_host TEXT,
      os TEXT,
      resources TEXT,
      tags TEXT,
      status TEXT DEFAULT 'unknown',
      last_seen DATETIME,
      last_health_check DATETIME,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      type TEXT,
      runtime TEXT,
      port INTEGER,
      health_endpoint TEXT,
      health_status TEXT DEFAULT 'unknown',
      last_health_check DATETIME,
      response_time_ms INTEGER,
      config TEXT,
      env_file TEXT,
      project_path TEXT,
      git_repo TEXT,
      git_branch TEXT DEFAULT 'main',
      current_version TEXT,
      deploy_command TEXT,
      restart_command TEXT,
      stop_command TEXT,
      log_command TEXT,
      status TEXT DEFAULT 'unknown',
      auto_restart INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, name)
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      path TEXT DEFAULT '/',
      service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
      method TEXT DEFAULT '*',
      proxy_type TEXT,
      ssl_type TEXT,
      rate_limit TEXT,
      auth_required INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(domain, path, method)
    );

    CREATE TABLE IF NOT EXISTS service_deps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      depends_on_service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      depends_on_external TEXT,
      dependency_type TEXT,
      connection_env_var TEXT,
      required INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      previous_version TEXT,
      deployed_by TEXT,
      deploy_method TEXT,
      status TEXT DEFAULT 'pending',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      duration_seconds INTEGER,
      output TEXT,
      error TEXT,
      rollback_version TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS infra_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_services_server ON services(server_id);
    CREATE INDEX IF NOT EXISTS idx_routes_service ON routes(service_id);
    CREATE INDEX IF NOT EXISTS idx_deployments_service ON deployments(service_id);
    CREATE INDEX IF NOT EXISTS idx_infra_events_server ON infra_events(server_id);
  `);
}

// ============================================================================
// Project Database
// ============================================================================

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

export function getProjectDb(): Database {
  const dbPath = getProjectDbPath();

  // Return cached instance if same path
  if (projectDbInstance && currentProjectDbPath === dbPath) {
    return projectDbInstance;
  }

  // Close existing connection if switching projects
  if (projectDbInstance) {
    projectDbInstance.close();
  }

  projectDbInstance = new Database(dbPath);
  currentProjectDbPath = dbPath;

  // Apply reliability pragmas (busy_timeout, WAL, etc.)
  applyReliabilityPragmas(projectDbInstance);

  // Run any pending migrations
  const migrationResult = runMigrations(projectDbInstance, dbPath);
  if (!migrationResult.ok) {
    // Log but don't fail - legacy DB might still work
    console.error(`⚠️  Migration warning: ${migrationResult.error.message}`);
  }

  // Also run legacy migrations for backwards compatibility
  migrateProjectDb(projectDbInstance);

  return projectDbInstance;
}

/**
 * Get project database with Drizzle ORM wrapper
 * Use for type-safe queries
 */
export function getProjectDrizzle(): DrizzleDb {
  if (projectDrizzleInstance && currentProjectDbPath === getProjectDbPath()) {
    return projectDrizzleInstance;
  }

  const db = getProjectDb();
  projectDrizzleInstance = drizzle(db, { schema });
  return projectDrizzleInstance;
}

export function initProjectDb(path: string): Database {
  const dir = join(path, LOCAL_DB_DIR);
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }

  const dbPath = join(dir, LOCAL_DB_NAME);
  const db = new Database(dbPath);

  // Apply reliability pragmas first
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

  // Update cached instance
  if (projectDbInstance) {
    projectDbInstance.close();
  }
  projectDbInstance = db;
  currentProjectDbPath = dbPath;

  return db;
}

function migrateProjectDb(db: Database): void {
  const migrations = [
    "ALTER TABLE files ADD COLUMN content_hash TEXT",
    "ALTER TABLE files ADD COLUMN fs_modified_at TEXT",
    "ALTER TABLE files ADD COLUMN last_queried_at TEXT",
    "ALTER TABLE sessions ADD COLUMN files_read TEXT",
    "ALTER TABLE sessions ADD COLUMN patterns_used TEXT",
    "ALTER TABLE sessions ADD COLUMN queries_made TEXT",
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists, ignore
    }
  }
}

// ============================================================================
// Project Management
// ============================================================================

import { basename } from "path";

export function ensureProject(db: Database, projectPath?: string): number {
  const path = projectPath || process.cwd();
  const name = basename(path);

  const existing = db.query<{ id: number }, [string]>(
    "SELECT id FROM projects WHERE path = ?"
  ).get(path);

  if (existing) {
    return existing.id;
  }

  const result = db.run(
    "INSERT INTO projects (path, name) VALUES (?, ?)",
    [path, name]
  );

  return Number(result.lastInsertRowid);
}

// ============================================================================
// Cleanup
// ============================================================================

export function closeAll(): void {
  if (globalDbInstance) {
    globalDbInstance.close();
    globalDbInstance = null;
    globalDrizzleInstance = null;
  }
  if (projectDbInstance) {
    projectDbInstance.close();
    projectDbInstance = null;
    projectDrizzleInstance = null;
    currentProjectDbPath = null;
  }
}

export function closeGlobalDb(): void {
  if (globalDbInstance) {
    globalDbInstance.close();
    globalDbInstance = null;
    globalDrizzleInstance = null;
  }
}

export function closeProjectDb(): void {
  if (projectDbInstance) {
    projectDbInstance.close();
    projectDbInstance = null;
    projectDrizzleInstance = null;
    currentProjectDbPath = null;
  }
}
