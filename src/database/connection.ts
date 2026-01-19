/**
 * Database connection management
 * Singleton pattern for global and project databases
 */

import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

// ============================================================================
// Configuration
// ============================================================================

export const GLOBAL_DB_PATH = join(process.env.HOME || "~", ".claude", "memory.db");
export const LOCAL_DB_DIR = ".claude";
export const LOCAL_DB_NAME = "memory.db";
export const SCHEMA_PATH = join(process.env.HOME || "~", ".claude", "schema.sql");

// ============================================================================
// Connection State
// ============================================================================

let globalDbInstance: Database | null = null;
let projectDbInstance: Database | null = null;
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
  globalDbInstance.exec("PRAGMA foreign_keys = ON");
  globalDbInstance.exec("PRAGMA journal_mode = WAL");

  // Ensure global tables exist
  initGlobalTables(globalDbInstance);

  return globalDbInstance;
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
  projectDbInstance.exec("PRAGMA foreign_keys = ON");
  projectDbInstance.exec("PRAGMA journal_mode = WAL");
  currentProjectDbPath = dbPath;

  migrateProjectDb(projectDbInstance);

  return projectDbInstance;
}

export function initProjectDb(path: string): Database {
  const dir = join(path, LOCAL_DB_DIR);
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }

  const dbPath = join(dir, LOCAL_DB_NAME);
  const db = new Database(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");

  // Load and execute schema
  if (existsSync(SCHEMA_PATH)) {
    const schema = readFileSync(SCHEMA_PATH, "utf-8");
    db.exec(schema);
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
  }
  if (projectDbInstance) {
    projectDbInstance.close();
    projectDbInstance = null;
    currentProjectDbPath = null;
  }
}

export function closeGlobalDb(): void {
  if (globalDbInstance) {
    globalDbInstance.close();
    globalDbInstance = null;
  }
}

export function closeProjectDb(): void {
  if (projectDbInstance) {
    projectDbInstance.close();
    projectDbInstance = null;
    currentProjectDbPath = null;
  }
}
