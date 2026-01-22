/**
 * Database Migration System
 *
 * God-tier schema versioning using SQLite's PRAGMA user_version.
 * Migrations are atomic, tracked, and validated.
 */

import { Database } from "bun:sqlite";
import { existsSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { Result, ok, err, ContextError } from "../utils/errors";

// ============================================================================
// Types
// ============================================================================

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: string;       // SQL to apply
  down?: string;    // SQL to rollback (optional, not all migrations are reversible)
  validate?: (db: Database) => boolean; // Optional validation after migration
}

export interface MigrationResult {
  version: number;
  name: string;
  status: 'applied' | 'skipped' | 'failed';
  duration_ms: number;
  error?: string;
}

export interface MigrationState {
  current_version: number;
  latest_version: number;
  pending_count: number;
  applied: MigrationResult[];
}

export interface IntegrityCheck {
  valid: boolean;
  version: number;
  issues: string[];
  tables: { name: string; exists: boolean }[];
  indexes: { name: string; exists: boolean }[];
}

// ============================================================================
// Migration Log
// ============================================================================

const LOG_PATH = join(process.env.HOME || "~", ".claude", "migrations.log");

function logMigration(
  dbPath: string,
  version: number,
  name: string,
  status: 'start' | 'success' | 'failed',
  error?: string
): void {
  const dir = join(process.env.HOME || "~", ".claude");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const line = JSON.stringify({ timestamp, dbPath, version, name, status, error }) + "\n";

  try {
    appendFileSync(LOG_PATH, line);
  } catch {
    // Ignore log failures - don't break migrations
  }
}

// ============================================================================
// Migration Registry
// ============================================================================

/**
 * All migrations in order. Each migration has a unique version number.
 * NEVER modify existing migrations - only add new ones.
 * Version numbers must be sequential starting from 1.
 */
export const MIGRATIONS: Migration[] = [
  // Version 1: Base schema (what we have now)
  {
    version: 1,
    name: "initial_schema",
    description: "Base schema with all existing tables, indexes, FTS, triggers, and views",
    up: `
      -- This is the "adopt existing" migration
      -- If tables already exist (from schema.sql), this is a no-op
      -- If fresh DB, the main schema.sql will have already run

      -- Just ensure our core tables exist with a lightweight check
      CREATE TABLE IF NOT EXISTS _migration_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('schema_initialized', datetime('now'));
    `,
    validate: (db) => {
      // Verify core tables exist
      const tables = ['projects', 'files', 'decisions', 'issues', 'sessions', 'learnings'];
      for (const table of tables) {
        const exists = db.query<{ name: string }, []>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table);
        if (!exists) return false;
      }
      return true;
    }
  },

  // Version 2: Add busy timeout and WAL checkpoint settings
  {
    version: 2,
    name: "reliability_pragmas",
    description: "Add busy_timeout for concurrent access, optimize WAL",
    up: `
      -- These are session-level, but we record that this version expects them
      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES
        ('expects_busy_timeout', '5000'),
        ('expects_wal_mode', 'true'),
        ('reliability_version', '2');
    `,
    validate: (db) => {
      const meta = db.query<{ value: string }, [string]>(
        `SELECT value FROM _migration_meta WHERE key = ?`
      ).get('reliability_version');
      return meta?.value === '2';
    }
  },

  // Version 3: Add migration history table for audit trail
  {
    version: 3,
    name: "migration_history",
    description: "Track all applied migrations with timestamps",
    up: `
      CREATE TABLE IF NOT EXISTS _migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration_ms INTEGER,
        checksum TEXT,
        UNIQUE(version)
      );

      -- Record that we've applied versions 1-3
      INSERT OR IGNORE INTO _migration_history (version, name, duration_ms)
      VALUES
        (1, 'initial_schema', 0),
        (2, 'reliability_pragmas', 0),
        (3, 'migration_history', 0);
    `,
    validate: (db) => {
      const exists = db.query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='_migration_history'`
      ).get();
      return !!exists;
    }
  },

  // Version 4: Add error log table
  {
    version: 4,
    name: "error_logging",
    description: "In-database error logging for debugging",
    up: `
      CREATE TABLE IF NOT EXISTS _error_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL,
        error_code TEXT,
        message TEXT NOT NULL,
        context TEXT,
        stack TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_error_log_time ON _error_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_error_log_source ON _error_log(source);

      -- Auto-cleanup: keep last 1000 errors
      CREATE TRIGGER IF NOT EXISTS error_log_cleanup
      AFTER INSERT ON _error_log
      BEGIN
        DELETE FROM _error_log
        WHERE id NOT IN (
          SELECT id FROM _error_log ORDER BY timestamp DESC LIMIT 1000
        );
      END;
    `,
    validate: (db) => {
      const exists = db.query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='_error_log'`
      ).get();
      return !!exists;
    }
  },

  // Version 5: Schema integrity checksums
  {
    version: 5,
    name: "schema_checksums",
    description: "Store checksums of critical tables for integrity verification",
    up: `
      CREATE TABLE IF NOT EXISTS _schema_checksums (
        table_name TEXT PRIMARY KEY,
        column_hash TEXT NOT NULL,
        index_hash TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- We'll populate these after migration
      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('checksums_enabled', 'true');
    `,
    validate: (db) => {
      const exists = db.query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_checksums'`
      ).get();
      return !!exists;
    }
  },

  // Version 6: File change correlations and session intelligence
  {
    version: 6,
    name: "session_intelligence",
    description: "Track file co-changes for predictive suggestions and enhanced session tracking",
    up: `
      -- File correlations: track which files change together
      CREATE TABLE IF NOT EXISTS file_correlations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_a TEXT NOT NULL,               -- First file path
        file_b TEXT NOT NULL,               -- Second file path (alphabetically after file_a)
        cochange_count INTEGER DEFAULT 1,   -- How many times changed together
        last_cochange DATETIME DEFAULT CURRENT_TIMESTAMP,
        avg_time_gap_seconds INTEGER,       -- Average time between changes
        correlation_strength REAL,          -- 0-1 calculated strength
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, file_a, file_b)
      );

      CREATE INDEX IF NOT EXISTS idx_correlations_project ON file_correlations(project_id);
      CREATE INDEX IF NOT EXISTS idx_correlations_file_a ON file_correlations(file_a);
      CREATE INDEX IF NOT EXISTS idx_correlations_file_b ON file_correlations(file_b);
      CREATE INDEX IF NOT EXISTS idx_correlations_strength ON file_correlations(correlation_strength DESC);

      -- Session learnings: auto-extracted patterns from sessions
      CREATE TABLE IF NOT EXISTS session_learnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        learning_id INTEGER REFERENCES learnings(id) ON DELETE SET NULL,
        extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confidence REAL,                    -- 0-1 confidence in the extraction
        auto_applied INTEGER DEFAULT 0      -- Whether it was automatically saved
      );

      CREATE INDEX IF NOT EXISTS idx_session_learnings_session ON session_learnings(session_id);

      -- Add status field to sessions if missing (for tracking active/ended)
      -- SQLite doesn't support ALTER COLUMN, so we check and add only
      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('session_intelligence_enabled', 'true');
    `,
    validate: (db) => {
      const exists = db.query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='file_correlations'`
      ).get();
      return !!exists;
    }
  }
];

// ============================================================================
// Version Management
// ============================================================================

/**
 * Get current schema version from PRAGMA user_version
 */
export function getSchemaVersion(db: Database): number {
  const result = db.query<{ user_version: number }, []>(
    "PRAGMA user_version"
  ).get();
  return result?.user_version ?? 0;
}

/**
 * Set schema version using PRAGMA user_version
 */
export function setSchemaVersion(db: Database, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

/**
 * Get the latest available migration version
 */
export function getLatestVersion(): number {
  return MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}

/**
 * Get pending migrations that need to be applied
 */
export function getPendingMigrations(db: Database): Migration[] {
  const currentVersion = getSchemaVersion(db);
  return MIGRATIONS.filter(m => m.version > currentVersion);
}

// ============================================================================
// Migration Runner
// ============================================================================

/**
 * Apply a single migration atomically
 */
function applyMigration(
  db: Database,
  migration: Migration,
  dbPath: string
): Result<MigrationResult> {
  const startTime = Date.now();

  logMigration(dbPath, migration.version, migration.name, 'start');

  try {
    // Run in transaction for atomicity
    db.exec("BEGIN IMMEDIATE");

    try {
      // Apply the migration SQL
      db.exec(migration.up);

      // Validate if validator provided
      if (migration.validate && !migration.validate(db)) {
        throw new Error(`Migration validation failed for ${migration.name}`);
      }

      // Update version
      setSchemaVersion(db, migration.version);

      // Record in history if table exists
      try {
        db.run(
          `INSERT OR REPLACE INTO _migration_history (version, name, duration_ms) VALUES (?, ?, ?)`,
          [migration.version, migration.name, Date.now() - startTime]
        );
      } catch {
        // History table might not exist yet (for early migrations)
      }

      db.exec("COMMIT");

      const duration = Date.now() - startTime;
      logMigration(dbPath, migration.version, migration.name, 'success');

      return ok({
        version: migration.version,
        name: migration.name,
        status: 'applied',
        duration_ms: duration
      });

    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMigration(dbPath, migration.version, migration.name, 'failed', message);

    return err(new ContextError(
      `Migration ${migration.version} (${migration.name}) failed: ${message}`,
      'DB_QUERY_ERROR',
      { version: migration.version, name: migration.name }
    ));
  }
}

/**
 * Apply all pending migrations
 */
export function runMigrations(
  db: Database,
  dbPath: string = 'unknown'
): Result<MigrationState> {
  const currentVersion = getSchemaVersion(db);
  const pending = getPendingMigrations(db);
  const results: MigrationResult[] = [];

  if (pending.length === 0) {
    return ok({
      current_version: currentVersion,
      latest_version: getLatestVersion(),
      pending_count: 0,
      applied: []
    });
  }

  // Sort by version to ensure correct order
  pending.sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const result = applyMigration(db, migration, dbPath);

    if (!result.ok) {
      // Stop on first failure
      return err(result.error);
    }

    results.push(result.value);
  }

  return ok({
    current_version: getSchemaVersion(db),
    latest_version: getLatestVersion(),
    pending_count: 0,
    applied: results
  });
}

// ============================================================================
// Integrity Checking
// ============================================================================

// Tables required in project databases
const REQUIRED_PROJECT_TABLES = [
  'projects', 'files', 'symbols', 'decisions', 'issues',
  'sessions', 'learnings', 'relationships',
  'bookmarks', 'focus', 'file_correlations', 'session_learnings'
];

// Tables that exist in global database only
const GLOBAL_ONLY_TABLES = [
  'servers', 'services', 'routes', 'service_deps', 'deployments', 'infra_events',
  'security_findings', 'quality_metrics', 'performance_findings'
];

// Combined for reference
const REQUIRED_TABLES = REQUIRED_PROJECT_TABLES;

const REQUIRED_INDEXES = [
  'idx_files_project', 'idx_files_fragility',
  'idx_decisions_project', 'idx_issues_project',
  'idx_sessions_project', 'idx_learnings_project'
];

const REQUIRED_FTS_TABLES = [
  'fts_files', 'fts_symbols', 'fts_decisions', 'fts_issues', 'fts_learnings'
];

/**
 * Check database schema integrity
 */
export function checkIntegrity(db: Database): IntegrityCheck {
  const version = getSchemaVersion(db);
  const issues: string[] = [];
  const tables: { name: string; exists: boolean }[] = [];
  const indexes: { name: string; exists: boolean }[] = [];

  // Check SQLite integrity
  try {
    const integrityResult = db.query<{ integrity_check: string }, []>(
      "PRAGMA integrity_check"
    ).get();
    if (integrityResult?.integrity_check !== 'ok') {
      issues.push(`SQLite integrity check failed: ${integrityResult?.integrity_check}`);
    }
  } catch (error) {
    issues.push(`Failed to run integrity check: ${error}`);
  }

  // Check required tables
  for (const table of REQUIRED_TABLES) {
    const exists = db.query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table);
    tables.push({ name: table, exists: !!exists });
    if (!exists) {
      issues.push(`Missing required table: ${table}`);
    }
  }

  // Check FTS tables
  for (const fts of REQUIRED_FTS_TABLES) {
    const exists = db.query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(fts);
    tables.push({ name: fts, exists: !!exists });
    if (!exists) {
      issues.push(`Missing FTS table: ${fts}`);
    }
  }

  // Check required indexes
  for (const index of REQUIRED_INDEXES) {
    const exists = db.query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
    ).get(index);
    indexes.push({ name: index, exists: !!exists });
    if (!exists) {
      issues.push(`Missing required index: ${index}`);
    }
  }

  // Check foreign keys are enabled
  const fkResult = db.query<{ foreign_keys: number }, []>(
    "PRAGMA foreign_keys"
  ).get();
  if (fkResult?.foreign_keys !== 1) {
    issues.push('Foreign keys are not enabled');
  }

  // Check WAL mode
  const journalResult = db.query<{ journal_mode: string }, []>(
    "PRAGMA journal_mode"
  ).get();
  if (journalResult?.journal_mode !== 'wal') {
    issues.push(`Journal mode is ${journalResult?.journal_mode}, expected WAL`);
  }

  // Check version is current
  if (version < getLatestVersion()) {
    issues.push(`Schema version ${version} is behind latest ${getLatestVersion()}`);
  }

  return {
    valid: issues.length === 0,
    version,
    issues,
    tables,
    indexes
  };
}

// ============================================================================
// Database Error Logging
// ============================================================================

/**
 * Log an error to the database (if error_log table exists)
 */
export function logDbError(
  db: Database,
  source: string,
  error: Error | string,
  context?: Record<string, unknown>
): void {
  try {
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;
    const errorCode = error instanceof ContextError ? error.code : 'UNKNOWN_ERROR';

    db.run(
      `INSERT INTO _error_log (source, error_code, message, context, stack) VALUES (?, ?, ?, ?, ?)`,
      [source, errorCode, message, context ? JSON.stringify(context) : null, stack ?? null]
    );
  } catch {
    // Silently fail - we're already handling an error
  }
}

/**
 * Get recent errors from the database
 */
export function getRecentErrors(
  db: Database,
  limit: number = 50
): Array<{
  id: number;
  timestamp: string;
  source: string;
  error_code: string | null;
  message: string;
}> {
  try {
    return db.query<{
      id: number;
      timestamp: string;
      source: string;
      error_code: string | null;
      message: string;
    }, [number]>(
      `SELECT id, timestamp, source, error_code, message
       FROM _error_log
       ORDER BY timestamp DESC
       LIMIT ?`
    ).all(limit);
  } catch {
    return [];
  }
}

// ============================================================================
// Session Pragmas
// ============================================================================

/**
 * Apply reliability pragmas to a database connection
 * Should be called after opening any connection
 */
export function applyReliabilityPragmas(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");  // Good balance of safety and speed
  db.exec("PRAGMA cache_size = -64000");   // 64MB cache
  db.exec("PRAGMA temp_store = MEMORY");
}

/**
 * Optimize database (run periodically or on session end)
 */
export function optimizeDatabase(db: Database): void {
  try {
    db.exec("PRAGMA optimize");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // Non-critical, ignore failures
  }
}
