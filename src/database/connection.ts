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
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { isGlobalProject, loadConfig } from "../config";
import type { DatabaseAdapter } from "./adapter";
import { LocalAdapter } from "./adapters/local";
import { NetworkAdapter } from "./adapters/network";
import {
  applyReliabilityPragmas,
  checkIntegrity,
  getLatestVersion,
  getSchemaVersion,
  type IntegrityCheck,
  logDbError,
  type MigrationState,
  runMigrations,
} from "./migrations";
import * as schema from "./schema";

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

let globalAdapterInstance: DatabaseAdapter | null = null;
let globalDrizzleInstance: DrizzleDb | null = null;
let projectAdapterInstance: DatabaseAdapter | null = null;
let projectDrizzleInstance: DrizzleDb | null = null;
let currentProjectDbPath: string | null = null;

// Load config once at module level
const config = loadConfig();

// Export config getter for network commands
export function getConfig() {
  return config;
}

// ============================================================================
// Global Database
// ============================================================================

export async function getGlobalDb(): Promise<DatabaseAdapter> {
  if (globalAdapterInstance) {
    return globalAdapterInstance;
  }

  const dir = join(process.env.HOME || "~", ".claude");
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }

  // Create adapter based on config
  if (config.mode === "network") {
    if (!config.primaryUrl) {
      throw new Error("Network mode requires MUNINN_PRIMARY_URL");
    }
    globalAdapterInstance = new NetworkAdapter({
      localPath: GLOBAL_DB_PATH,
      primaryUrl: config.primaryUrl,
      authToken: config.authToken,
      syncInterval: config.syncInterval,
    });
    // Perform initial sync to pull schema/data from remote
    await globalAdapterInstance.init();
  } else {
    const db = new Database(GLOBAL_DB_PATH);
    applyReliabilityPragmas(db);
    globalAdapterInstance = new LocalAdapter(db);
  }

  // Ensure global tables exist (use raw DB for schema init)
  if (config.mode === "local") {
    const rawDb = globalAdapterInstance.raw() as Database;
    await initGlobalTables(rawDb);
  } else {
    // For network mode, use exec through adapter
    await initGlobalTablesAsync(globalAdapterInstance);
    // Sync again to pull newly created tables from remote to local replica
    await globalAdapterInstance.sync();
  }

  return globalAdapterInstance;
}

/**
 * Get global database with Drizzle ORM wrapper
 * Use for type-safe queries
 * Note: Only works in local mode (Drizzle requires bun:sqlite Database)
 */
export async function getGlobalDrizzle(): Promise<DrizzleDb> {
  if (globalDrizzleInstance) {
    return globalDrizzleInstance;
  }

  if (config.mode !== "local") {
    throw new Error("Drizzle ORM only supported in local mode");
  }

  const adapter = await getGlobalDb();
  const db = adapter.raw() as Database;
  globalDrizzleInstance = drizzle(db, { schema });
  return globalDrizzleInstance;
}

async function initGlobalTablesAsync(adapter: DatabaseAdapter): Promise<void> {
  await adapter.exec(`
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

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      stack TEXT,
      status TEXT DEFAULT 'active',
      mode TEXT DEFAULT 'exploring',
      previous_paths TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Project tables (for global projects feature)
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      type TEXT,
      purpose TEXT,
      exports TEXT,
      dependencies TEXT,
      dependents TEXT,
      fragility INTEGER DEFAULT 0,
      fragility_reason TEXT,
      status TEXT DEFAULT 'active',
      last_modified TEXT,
      last_analyzed TEXT,
      embedding BLOB,
      content_hash TEXT,
      fs_modified_at TEXT,
      last_queried_at TEXT,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      velocity_score REAL DEFAULT 0.0,
      change_count INTEGER DEFAULT 0,
      first_changed_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      signature TEXT,
      purpose TEXT,
      parameters TEXT,
      returns TEXT,
      side_effects TEXT,
      callers TEXT,
      calls TEXT,
      complexity INTEGER DEFAULT 0,
      embedding BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      decision TEXT NOT NULL,
      reasoning TEXT,
      alternatives TEXT,
      consequences TEXT,
      affects TEXT,
      status TEXT DEFAULT 'active',
      superseded_by INTEGER,
      invariant TEXT,
      constraint_type TEXT DEFAULT 'should_hold',
      decided_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      outcome_status TEXT DEFAULT 'pending',
      outcome_notes TEXT,
      outcome_at TEXT,
      check_after_sessions INTEGER DEFAULT 5,
      sessions_since INTEGER DEFAULT 0,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'bug',
      severity INTEGER DEFAULT 5,
      status TEXT DEFAULT 'open',
      affected_files TEXT,
      related_symbols TEXT,
      workaround TEXT,
      resolution TEXT,
      resolved_at TEXT,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      goal TEXT,
      outcome TEXT,
      files_touched TEXT,
      files_read TEXT,
      patterns_used TEXT,
      queries_made TEXT,
      decisions_made TEXT,
      issues_found TEXT,
      issues_resolved TEXT,
      learnings TEXT,
      next_steps TEXT,
      success INTEGER,
      session_number INTEGER
    );

    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      source TEXT,
      confidence INTEGER DEFAULT 5,
      times_applied INTEGER DEFAULT 0,
      last_applied TEXT,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT DEFAULT 'insight',
      content TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      session_id INTEGER,
      embedding BLOB,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS open_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      context TEXT,
      priority INTEGER DEFAULT 3,
      status TEXT DEFAULT 'open',
      resolution TEXT,
      session_id INTEGER,
      embedding BLOB,
      resolved_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      content_type TEXT DEFAULT 'text',
      priority INTEGER DEFAULT 3,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS focus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id INTEGER,
      area TEXT NOT NULL,
      description TEXT,
      files TEXT,
      keywords TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      cleared_at TEXT
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      relationship TEXT NOT NULL,
      strength INTEGER DEFAULT 5,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blast_radius (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_file TEXT NOT NULL,
      affected_file TEXT NOT NULL,
      distance INTEGER NOT NULL DEFAULT 1,
      dependency_path TEXT,
      is_test INTEGER DEFAULT 0,
      is_route INTEGER DEFAULT 0,
      computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blast_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      direct_dependents INTEGER DEFAULT 0,
      transitive_dependents INTEGER DEFAULT 0,
      total_affected INTEGER DEFAULT 0,
      max_depth INTEGER DEFAULT 0,
      affected_tests INTEGER DEFAULT 0,
      affected_routes INTEGER DEFAULT 0,
      blast_score REAL DEFAULT 0.0,
      computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS developer_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      evidence TEXT,
      confidence REAL DEFAULT 0.5,
      category TEXT NOT NULL,
      source TEXT DEFAULT 'inferred',
      times_confirmed INTEGER DEFAULT 1,
      embedding BLOB,
      last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence TEXT,
      confidence REAL DEFAULT 0.5,
      status TEXT DEFAULT 'new',
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TEXT,
      embedding BLOB
    );

    -- FTS tables for project data
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_files USING fts5(path, purpose, type);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_decisions USING fts5(title, decision, reasoning);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_issues USING fts5(title, description);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_learnings USING fts5(title, content, context);

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_services_server ON services(server_id);
    CREATE INDEX IF NOT EXISTS idx_routes_service ON routes(service_id);
    CREATE INDEX IF NOT EXISTS idx_deployments_service ON deployments(service_id);
    CREATE INDEX IF NOT EXISTS idx_infra_events_server ON infra_events(server_id);
    CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
    CREATE INDEX IF NOT EXISTS idx_files_fragility ON files(fragility);
    CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
    CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_project_path ON files(project_id, path);
  `);
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

    CREATE TABLE IF NOT EXISTS global_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'insight',
      content TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      source_project TEXT,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      stack TEXT,
      status TEXT DEFAULT 'active',
      mode TEXT DEFAULT 'exploring',
      previous_paths TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Project tables (for global projects feature)
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      type TEXT,
      purpose TEXT,
      exports TEXT,
      dependencies TEXT,
      dependents TEXT,
      fragility INTEGER DEFAULT 0,
      fragility_reason TEXT,
      status TEXT DEFAULT 'active',
      last_modified TEXT,
      last_analyzed TEXT,
      embedding BLOB,
      content_hash TEXT,
      fs_modified_at TEXT,
      last_queried_at TEXT,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      velocity_score REAL DEFAULT 0.0,
      change_count INTEGER DEFAULT 0,
      first_changed_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      signature TEXT,
      purpose TEXT,
      parameters TEXT,
      returns TEXT,
      side_effects TEXT,
      callers TEXT,
      calls TEXT,
      complexity INTEGER DEFAULT 0,
      embedding BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      decision TEXT NOT NULL,
      reasoning TEXT,
      alternatives TEXT,
      consequences TEXT,
      affects TEXT,
      status TEXT DEFAULT 'active',
      superseded_by INTEGER,
      invariant TEXT,
      constraint_type TEXT DEFAULT 'should_hold',
      decided_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      outcome_status TEXT DEFAULT 'pending',
      outcome_notes TEXT,
      outcome_at TEXT,
      check_after_sessions INTEGER DEFAULT 5,
      sessions_since INTEGER DEFAULT 0,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'bug',
      severity INTEGER DEFAULT 5,
      status TEXT DEFAULT 'open',
      affected_files TEXT,
      related_symbols TEXT,
      workaround TEXT,
      resolution TEXT,
      resolved_at TEXT,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      goal TEXT,
      outcome TEXT,
      files_touched TEXT,
      files_read TEXT,
      patterns_used TEXT,
      queries_made TEXT,
      decisions_made TEXT,
      issues_found TEXT,
      issues_resolved TEXT,
      learnings TEXT,
      next_steps TEXT,
      success INTEGER,
      session_number INTEGER
    );

    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      source TEXT,
      confidence INTEGER DEFAULT 5,
      times_applied INTEGER DEFAULT 0,
      last_applied TEXT,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT DEFAULT 'insight',
      content TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      session_id INTEGER,
      embedding BLOB,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS open_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      context TEXT,
      priority INTEGER DEFAULT 3,
      status TEXT DEFAULT 'open',
      resolution TEXT,
      session_id INTEGER,
      embedding BLOB,
      resolved_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      content_type TEXT DEFAULT 'text',
      priority INTEGER DEFAULT 3,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS focus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id INTEGER,
      area TEXT NOT NULL,
      description TEXT,
      files TEXT,
      keywords TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      cleared_at TEXT
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      relationship TEXT NOT NULL,
      strength INTEGER DEFAULT 5,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blast_radius (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_file TEXT NOT NULL,
      affected_file TEXT NOT NULL,
      distance INTEGER NOT NULL DEFAULT 1,
      dependency_path TEXT,
      is_test INTEGER DEFAULT 0,
      is_route INTEGER DEFAULT 0,
      computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blast_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      direct_dependents INTEGER DEFAULT 0,
      transitive_dependents INTEGER DEFAULT 0,
      total_affected INTEGER DEFAULT 0,
      max_depth INTEGER DEFAULT 0,
      affected_tests INTEGER DEFAULT 0,
      affected_routes INTEGER DEFAULT 0,
      blast_score REAL DEFAULT 0.0,
      computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS developer_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      evidence TEXT,
      confidence REAL DEFAULT 0.5,
      category TEXT NOT NULL,
      source TEXT DEFAULT 'inferred',
      times_confirmed INTEGER DEFAULT 1,
      embedding BLOB,
      last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence TEXT,
      confidence REAL DEFAULT 0.5,
      status TEXT DEFAULT 'new',
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TEXT,
      embedding BLOB
    );

    -- FTS tables for project data
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_files USING fts5(path, purpose, type);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_decisions USING fts5(title, decision, reasoning);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_issues USING fts5(title, description);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_learnings USING fts5(title, content, context);

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_services_server ON services(server_id);
    CREATE INDEX IF NOT EXISTS idx_routes_service ON routes(service_id);
    CREATE INDEX IF NOT EXISTS idx_deployments_service ON deployments(service_id);
    CREATE INDEX IF NOT EXISTS idx_infra_events_server ON infra_events(server_id);
    CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
    CREATE INDEX IF NOT EXISTS idx_files_fragility ON files(fragility);
    CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
    CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_project_path ON files(project_id, path);
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

export async function getProjectDb(): Promise<DatabaseAdapter> {
  // Check if current project should use global database
  const cwd = process.cwd();
  if (isGlobalProject(cwd)) {
    return getGlobalDb();
  }

  const dbPath = getProjectDbPath();

  // Return cached instance if same path
  if (projectAdapterInstance && currentProjectDbPath === dbPath) {
    return projectAdapterInstance;
  }

  // Close existing connection if switching projects
  if (projectAdapterInstance) {
    projectAdapterInstance.close();
  }

  // Create adapter based on config
  if (config.mode === "network") {
    if (!config.primaryUrl) {
      throw new Error("Network mode requires MUNINN_PRIMARY_URL");
    }
    projectAdapterInstance = new NetworkAdapter({
      localPath: dbPath,
      primaryUrl: config.primaryUrl,
      authToken: config.authToken,
      syncInterval: config.syncInterval,
    });
    // Perform initial sync to pull schema/data from remote
    await projectAdapterInstance.init();
  } else {
    const db = new Database(dbPath);
    applyReliabilityPragmas(db);

    // Run any pending migrations (sync for local mode)
    const migrationResult = runMigrations(db, dbPath);
    if (!migrationResult.ok) {
      console.error(`⚠️  Migration warning: ${migrationResult.error.message}`);
    }

    // Also run legacy migrations for backwards compatibility
    migrateProjectDb(db);

    projectAdapterInstance = new LocalAdapter(db);
  }

  currentProjectDbPath = dbPath;
  return projectAdapterInstance;
}

/**
 * Get project database with Drizzle ORM wrapper
 * Use for type-safe queries
 * Note: Only works in local mode (Drizzle requires bun:sqlite Database)
 */
export async function getProjectDrizzle(): Promise<DrizzleDb> {
  if (projectDrizzleInstance && currentProjectDbPath === getProjectDbPath()) {
    return projectDrizzleInstance;
  }

  if (config.mode !== "local") {
    throw new Error("Drizzle ORM only supported in local mode");
  }

  const adapter = await getProjectDb();
  const db = adapter.raw() as Database;
  projectDrizzleInstance = drizzle(db, { schema });
  return projectDrizzleInstance;
}

export async function initProjectDb(path: string): Promise<DatabaseAdapter> {
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
  if (config.mode === "network") {
    if (!config.primaryUrl) {
      throw new Error("Network mode requires MUNINN_PRIMARY_URL");
    }

    // For network mode, create adapter and load schema
    projectAdapterInstance = new NetworkAdapter({
      localPath: dbPath,
      primaryUrl: config.primaryUrl,
      authToken: config.authToken,
      syncInterval: config.syncInterval,
    });
    // Perform initial sync to pull any existing data from remote
    await projectAdapterInstance.init();

    // Load and execute schema asynchronously
    if (existsSync(SCHEMA_PATH)) {
      const schema = readFileSync(SCHEMA_PATH, "utf-8");
      await projectAdapterInstance.exec(schema);
      // Sync again to pull newly created tables from remote to local replica
      await projectAdapterInstance.sync();
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

import { basename } from "node:path";

export async function ensureProject(adapter: DatabaseAdapter, projectPath?: string): Promise<number> {
  const path = projectPath || process.cwd();
  const name = basename(path);

  const existing = await adapter.get<{ id: number }>("SELECT id FROM projects WHERE path = ?", [path]);

  if (existing) {
    syncProjectToGlobal(path, name);
    return existing.id;
  }

  // Detect project rename: if no match by path, check for a project
  // with the most data that likely IS this project under an old path.
  // This DB is project-local (.claude/memory.db inside the project dir),
  // so any existing project with a stale path is a rename candidate.
  const renamed = await adapter.get<{ id: number; path: string }>(`
    SELECT p.id, p.path FROM projects p
    LEFT JOIN files f ON f.project_id = p.id
    GROUP BY p.id
    ORDER BY COUNT(f.id) DESC
    LIMIT 1
  `);

  if (renamed && renamed.path !== path) {
    // Preserve old path in rename history
    const prev = await adapter.get<{ previous_paths: string | null }>(
      "SELECT previous_paths FROM projects WHERE id = ?",
      [renamed.id]
    );
    const history: string[] = prev?.previous_paths ? JSON.parse(prev.previous_paths) : [];
    if (!history.includes(renamed.path)) {
      history.push(renamed.path);
    }
    await adapter.run("UPDATE projects SET path = ?, name = ?, previous_paths = ? WHERE id = ?", [
      path,
      name,
      JSON.stringify(history),
      renamed.id,
    ]);
    await syncProjectToGlobal(path, name);
    return renamed.id;
  }

  const result = await adapter.run("INSERT INTO projects (path, name) VALUES (?, ?)", [path, name]);

  await syncProjectToGlobal(path, name);
  return Number(result.lastInsertRowid);
}

const syncedProjects = new Set<string>();

async function syncProjectToGlobal(projectPath: string, projectName: string): Promise<void> {
  if (syncedProjects.has(projectPath)) return;

  const localDbPath = join(projectPath, LOCAL_DB_DIR, LOCAL_DB_NAME);
  if (!existsSync(localDbPath)) return;

  try {
    const globalAdapter = await getGlobalDb();

    // Skip if this path is a subdirectory of an existing project
    const parentProject = await globalAdapter.get<{ path: string }>(
      "SELECT path FROM projects WHERE ? LIKE path || '/%'",
      [projectPath]
    );
    if (parentProject) {
      syncedProjects.add(projectPath); // Don't check again
      return;
    }

    const existing = await globalAdapter.get<{ id: number; name: string }>(
      "SELECT id, name FROM projects WHERE path = ?",
      [projectPath]
    );

    if (!existing) {
      await globalAdapter.run("INSERT INTO projects (path, name, status) VALUES (?, ?, 'active')", [
        projectPath,
        projectName,
        "active",
      ]);
    } else if (existing.name !== projectName) {
      await globalAdapter.run("UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
        projectName,
        existing.id,
      ]);
    }
    syncedProjects.add(projectPath);
  } catch {
    // Non-fatal: global sync failure shouldn't break local operations
  }
}

// ============================================================================
// Cleanup
// ============================================================================

export function closeAll(): void {
  if (globalAdapterInstance) {
    globalAdapterInstance.close();
    globalAdapterInstance = null;
    globalDrizzleInstance = null;
  }
  if (projectAdapterInstance) {
    projectAdapterInstance.close();
    projectAdapterInstance = null;
    projectDrizzleInstance = null;
    currentProjectDbPath = null;
  }
}

export function closeGlobalDb(): void {
  if (globalAdapterInstance) {
    globalAdapterInstance.close();
    globalAdapterInstance = null;
    globalDrizzleInstance = null;
  }
}

export function closeProjectDb(): void {
  if (projectAdapterInstance) {
    projectAdapterInstance.close();
    projectAdapterInstance = null;
    projectDrizzleInstance = null;
    currentProjectDbPath = null;
  }
}
