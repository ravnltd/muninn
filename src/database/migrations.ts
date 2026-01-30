/**
 * Database Migration System
 *
 * God-tier schema versioning using SQLite's PRAGMA user_version.
 * Migrations are atomic, tracked, and validated.
 */

import type { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ContextError, err, ok, type Result } from "../utils/errors";

// ============================================================================
// Types
// ============================================================================

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: string; // SQL to apply
  down?: string; // SQL to rollback (optional, not all migrations are reversible)
  validate?: (db: Database) => boolean; // Optional validation after migration
}

export interface MigrationResult {
  version: number;
  name: string;
  status: "applied" | "skipped" | "failed";
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
  status: "start" | "success" | "failed",
  error?: string
): void {
  const dir = join(process.env.HOME || "~", ".claude");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const line = `${JSON.stringify({ timestamp, dbPath, version, name, status, error })}\n`;

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
      const tables = ["projects", "files", "decisions", "issues", "sessions", "learnings"];
      for (const table of tables) {
        const exists = db
          .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
          .get(table);
        if (!exists) return false;
      }
      return true;
    },
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
      const meta = db
        .query<{ value: string }, [string]>(`SELECT value FROM _migration_meta WHERE key = ?`)
        .get("reliability_version");
      return meta?.value === "2";
    },
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
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='_migration_history'`)
        .get();
      return !!exists;
    },
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
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='_error_log'`)
        .get();
      return !!exists;
    },
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
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_checksums'`)
        .get();
      return !!exists;
    },
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
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='file_correlations'`)
        .get();
      return !!exists;
    },
  },

  // Version 7: Intelligence System v2 - Decision Entanglement, Intent Preservation, Project Modes
  {
    version: 7,
    name: "intelligence_v2",
    description: "Decision entanglement, intent preservation (invariants), and project mode awareness",
    up: `
      -- ========================================================================
      -- DECISION ENTANGLEMENT
      -- Track which decisions depend on or invalidate other decisions
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS decision_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        linked_decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL,              -- 'depends_on', 'invalidates', 'requires_reconsider', 'supersedes', 'contradicts'
        strength REAL DEFAULT 0.5,            -- 0-1 how tightly coupled
        reason TEXT,                          -- why these are linked
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(decision_id, linked_decision_id, link_type)
      );

      CREATE INDEX IF NOT EXISTS idx_decision_links_decision ON decision_links(decision_id);
      CREATE INDEX IF NOT EXISTS idx_decision_links_linked ON decision_links(linked_decision_id);
      CREATE INDEX IF NOT EXISTS idx_decision_links_type ON decision_links(link_type);

      -- View: If you touch decision X, these also need review
      CREATE VIEW IF NOT EXISTS v_decision_ripple AS
      SELECT
        d1.id as decision_id,
        d1.title as decision_title,
        dl.link_type,
        dl.strength,
        d2.id as linked_id,
        d2.title as linked_title,
        d2.status as linked_status
      FROM decisions d1
      JOIN decision_links dl ON d1.id = dl.decision_id
      JOIN decisions d2 ON dl.linked_decision_id = d2.id
      WHERE d2.status = 'active'
      ORDER BY dl.strength DESC;

      -- ========================================================================
      -- INTENT PRESERVATION (INVARIANTS)
      -- Store the deeper WHY - the constraint that must hold
      -- ========================================================================
      ALTER TABLE decisions ADD COLUMN invariant TEXT;
      -- e.g., "API calls must not exceed 100/min" explains why caching exists

      ALTER TABLE decisions ADD COLUMN constraint_type TEXT DEFAULT 'should_hold';
      -- 'must_hold' = breaking this breaks the system
      -- 'should_hold' = important but survivable
      -- 'nice_to_have' = preference, not requirement

      -- ========================================================================
      -- PROJECT MODE AWARENESS
      -- Track what phase a project is in for behavior adjustment
      -- ========================================================================
      ALTER TABLE projects ADD COLUMN mode TEXT DEFAULT 'exploring';
      -- 'exploring' = tolerate mess, try things
      -- 'building' = making progress, some structure
      -- 'hardening' = pre-launch rigor, tests required
      -- 'shipping' = deploy focus, minimal changes
      -- 'maintaining' = stability over features

      -- Track mode transitions for history
      CREATE TABLE IF NOT EXISTS mode_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        from_mode TEXT,
        to_mode TEXT NOT NULL,
        reason TEXT,                          -- why the transition happened
        transitioned_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_mode_transitions_project ON mode_transitions(project_id);
      CREATE INDEX IF NOT EXISTS idx_mode_transitions_time ON mode_transitions(transitioned_at DESC);

      -- Record migration
      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES
        ('intelligence_v2_enabled', 'true'),
        ('decision_entanglement', 'true'),
        ('intent_preservation', 'true'),
        ('project_modes', 'true');
    `,
    validate: (db) => {
      // Check decision_links table exists
      const linksExist = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='decision_links'`)
        .get();

      // Check mode_transitions table exists
      const modesExist = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='mode_transitions'`)
        .get();

      // Check invariant column exists on decisions
      const invariantExists = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('decisions') WHERE name='invariant'`)
        .get();

      // Check mode column exists on projects
      const modeExists = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('projects') WHERE name='mode'`)
        .get();

      return !!linksExist && !!modesExist && !!invariantExists && !!modeExists;
    },
  },

  // Version 8: Blast Radius Engine - Precomputed transitive dependency impact
  {
    version: 8,
    name: "blast_radius_engine",
    description: "Precompute transitive dependency impact for safer editing",
    up: `
      -- ========================================================================
      -- BLAST RADIUS ENGINE
      -- Precompute what files are affected when you change a file
      -- ========================================================================

      -- Individual dependency edges with distance (hops)
      CREATE TABLE IF NOT EXISTS blast_radius (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_file TEXT NOT NULL,            -- File being changed
        affected_file TEXT NOT NULL,          -- File that would be affected
        distance INTEGER NOT NULL DEFAULT 1,  -- Hops: 1=direct, 2+=transitive
        dependency_path TEXT,                 -- JSON array: path from source to affected
        is_test INTEGER DEFAULT 0,            -- 1 if affected_file is a test
        is_route INTEGER DEFAULT 0,           -- 1 if affected_file is a route/page
        computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, source_file, affected_file)
      );

      CREATE INDEX IF NOT EXISTS idx_blast_radius_project ON blast_radius(project_id);
      CREATE INDEX IF NOT EXISTS idx_blast_radius_source ON blast_radius(source_file);
      CREATE INDEX IF NOT EXISTS idx_blast_radius_affected ON blast_radius(affected_file);
      CREATE INDEX IF NOT EXISTS idx_blast_radius_distance ON blast_radius(distance);
      CREATE INDEX IF NOT EXISTS idx_blast_radius_tests ON blast_radius(project_id, is_test) WHERE is_test = 1;
      CREATE INDEX IF NOT EXISTS idx_blast_radius_routes ON blast_radius(project_id, is_route) WHERE is_route = 1;

      -- Aggregated summary per file for quick lookup
      CREATE TABLE IF NOT EXISTS blast_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,              -- The file being summarized
        direct_dependents INTEGER DEFAULT 0,  -- Count of distance=1
        transitive_dependents INTEGER DEFAULT 0, -- Count of distance>1
        total_affected INTEGER DEFAULT 0,     -- Total unique affected files
        max_depth INTEGER DEFAULT 0,          -- Deepest transitive chain
        affected_tests INTEGER DEFAULT 0,     -- Count of affected test files
        affected_routes INTEGER DEFAULT 0,    -- Count of affected route files
        blast_score REAL DEFAULT 0.0,         -- Computed risk score (0-100)
        computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, file_path)
      );

      CREATE INDEX IF NOT EXISTS idx_blast_summary_project ON blast_summary(project_id);
      CREATE INDEX IF NOT EXISTS idx_blast_summary_file ON blast_summary(file_path);
      CREATE INDEX IF NOT EXISTS idx_blast_summary_score ON blast_summary(blast_score DESC);

      -- View: High-impact files (blast score > 50)
      CREATE VIEW IF NOT EXISTS v_high_impact_files AS
      SELECT
        bs.file_path,
        bs.blast_score,
        bs.total_affected,
        bs.affected_tests,
        bs.affected_routes,
        bs.max_depth,
        f.fragility,
        f.purpose,
        p.name as project_name
      FROM blast_summary bs
      JOIN projects p ON bs.project_id = p.id
      LEFT JOIN files f ON bs.project_id = f.project_id AND bs.file_path = f.path
      WHERE bs.blast_score >= 50
      ORDER BY bs.blast_score DESC;

      -- View: Affected tests for a given file
      CREATE VIEW IF NOT EXISTS v_blast_tests AS
      SELECT
        br.source_file,
        br.affected_file as test_file,
        br.distance,
        br.dependency_path,
        p.name as project_name
      FROM blast_radius br
      JOIN projects p ON br.project_id = p.id
      WHERE br.is_test = 1
      ORDER BY br.distance ASC;

      -- Record migration
      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES
        ('blast_radius_enabled', 'true'),
        ('blast_radius_version', '1');
    `,
    validate: (db) => {
      // Check blast_radius table exists
      const radiusExists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='blast_radius'`)
        .get();

      // Check blast_summary table exists
      const summaryExists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='blast_summary'`)
        .get();

      return !!radiusExists && !!summaryExists;
    },
  },

  // Version 9: Continuity & Self-Improvement System
  {
    version: 9,
    name: "continuity_system",
    description: "Observations, open questions, workflow patterns, and temperature system for cross-session learning",
    up: `
      -- ========================================================================
      -- OBSERVATIONS — Lightweight notes-to-self
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'insight',  -- pattern, frustration, insight, dropped_thread, preference, behavior
        content TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,           -- Auto-incremented on dedup
        session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
        embedding BLOB,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project_id);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_frequency ON observations(frequency DESC);
      CREATE INDEX IF NOT EXISTS idx_observations_last_seen ON observations(last_seen_at DESC);

      -- FTS for observations
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_observations USING fts5(
        content, type
      );

      -- ========================================================================
      -- OPEN QUESTIONS — Deferred question parking lot
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS open_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        context TEXT,
        priority INTEGER DEFAULT 3,            -- 1-5 (1=highest)
        status TEXT DEFAULT 'open',            -- open, resolved, dropped
        resolution TEXT,
        session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
        embedding BLOB,
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_questions_project ON open_questions(project_id);
      CREATE INDEX IF NOT EXISTS idx_questions_status ON open_questions(status);
      CREATE INDEX IF NOT EXISTS idx_questions_priority ON open_questions(priority);

      -- FTS for questions
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_questions USING fts5(
        question, context
      );

      -- ========================================================================
      -- WORKFLOW PATTERNS — How the user works on different task types
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS workflow_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        task_type TEXT NOT NULL,               -- code_review, debugging, feature_build, creative, research, refactor
        approach TEXT NOT NULL,
        preferences TEXT,                      -- JSON object
        examples TEXT,                         -- JSON array
        times_used INTEGER DEFAULT 1,
        last_used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, task_type)
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_project ON workflow_patterns(project_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_task_type ON workflow_patterns(task_type);

      -- ========================================================================
      -- TEMPERATURE SYSTEM — Hot/warm/cold tracking
      -- Add temperature columns to existing tables
      -- ========================================================================
      ALTER TABLE files ADD COLUMN temperature TEXT DEFAULT 'cold';
      ALTER TABLE files ADD COLUMN last_referenced_at DATETIME;

      ALTER TABLE decisions ADD COLUMN temperature TEXT DEFAULT 'cold';
      ALTER TABLE decisions ADD COLUMN last_referenced_at DATETIME;

      ALTER TABLE issues ADD COLUMN temperature TEXT DEFAULT 'cold';
      ALTER TABLE issues ADD COLUMN last_referenced_at DATETIME;

      ALTER TABLE learnings ADD COLUMN temperature TEXT DEFAULT 'cold';
      ALTER TABLE learnings ADD COLUMN last_referenced_at DATETIME;

      -- Record migration
      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES
        ('continuity_system_enabled', 'true'),
        ('observations_enabled', 'true'),
        ('open_questions_enabled', 'true'),
        ('workflow_patterns_enabled', 'true'),
        ('temperature_system_enabled', 'true');
    `,
    validate: (db) => {
      const obsExists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='observations'`)
        .get();

      const qExists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='open_questions'`)
        .get();

      const wfExists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_patterns'`)
        .get();

      return !!obsExists && !!qExists && !!wfExists;
    },
  },

  // Version 10: Developer Profile Engine
  {
    version: 10,
    name: "developer_profile",
    description: "Track developer preferences, coding style, and patterns with confidence scoring",
    up: `
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, key)
      );

      CREATE TABLE IF NOT EXISTS global_developer_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        evidence TEXT,
        confidence REAL DEFAULT 0.5,
        category TEXT NOT NULL,
        source TEXT DEFAULT 'inferred',
        times_confirmed INTEGER DEFAULT 1,
        last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_profile_project ON developer_profile(project_id);
      CREATE INDEX IF NOT EXISTS idx_profile_confidence ON developer_profile(confidence DESC);

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('developer_profile_enabled', 'true');
    `,
    validate: (db) => {
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='developer_profile'`)
        .get();
      return !!exists;
    },
  },

  // Version 11: Outcome Tracking for Decisions
  {
    version: 11,
    name: "outcome_tracking",
    description: "Track whether decisions worked out over time",
    up: `
      ALTER TABLE decisions ADD COLUMN outcome_status TEXT DEFAULT 'pending';
      ALTER TABLE decisions ADD COLUMN outcome_notes TEXT;
      ALTER TABLE decisions ADD COLUMN outcome_at DATETIME;
      ALTER TABLE decisions ADD COLUMN check_after_sessions INTEGER DEFAULT 5;
      ALTER TABLE decisions ADD COLUMN sessions_since INTEGER DEFAULT 0;

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('outcome_tracking_enabled', 'true');
    `,
    validate: (db) => {
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('decisions') WHERE name='outcome_status'`)
        .get();
      return !!exists;
    },
  },

  // Version 12: Temporal Intelligence
  {
    version: 12,
    name: "temporal_intelligence",
    description: "File velocity scoring and session numbering for time-aware search",
    up: `
      ALTER TABLE files ADD COLUMN velocity_score REAL DEFAULT 0.0;
      ALTER TABLE files ADD COLUMN change_count INTEGER DEFAULT 0;
      ALTER TABLE files ADD COLUMN first_changed_at DATETIME;
      ALTER TABLE sessions ADD COLUMN session_number INTEGER;

      CREATE INDEX IF NOT EXISTS idx_files_velocity ON files(velocity_score DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_number ON sessions(project_id, session_number);

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('temporal_intelligence_enabled', 'true');
    `,
    validate: (db) => {
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('files') WHERE name='velocity_score'`)
        .get();
      return !!exists;
    },
  },

  // Version 13: Active Inference Engine (Insights)
  {
    version: 13,
    name: "active_inference",
    description: "Cross-session insights generated from pattern analysis",
    up: `
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
        acknowledged_at DATETIME,
        embedding BLOB,
        UNIQUE(project_id, title)
      );

      CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status);
      CREATE INDEX IF NOT EXISTS idx_insights_confidence ON insights(confidence DESC);
      CREATE INDEX IF NOT EXISTS idx_insights_project ON insights(project_id);

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('active_inference_enabled', 'true');
    `,
    validate: (db) => {
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='insights'`)
        .get();
      return !!exists;
    },
  },
  // Version 14: Consolidation & Long Memory
  {
    version: 14,
    name: "consolidation",
    description: "Add archival columns and consolidation table for long-term memory management",
    up: `
      ALTER TABLE files ADD COLUMN archived_at TEXT;
      ALTER TABLE files ADD COLUMN consolidated_into INTEGER;

      ALTER TABLE decisions ADD COLUMN archived_at TEXT;
      ALTER TABLE decisions ADD COLUMN consolidated_into INTEGER;

      ALTER TABLE issues ADD COLUMN archived_at TEXT;
      ALTER TABLE issues ADD COLUMN consolidated_into INTEGER;

      ALTER TABLE learnings ADD COLUMN archived_at TEXT;
      ALTER TABLE learnings ADD COLUMN consolidated_into INTEGER;

      CREATE TABLE IF NOT EXISTS consolidations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        source_ids TEXT NOT NULL,
        summary_title TEXT NOT NULL,
        summary_content TEXT NOT NULL,
        entity_count INTEGER NOT NULL,
        confidence REAL DEFAULT 0.8,
        embedding BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_consolidations_project ON consolidations(project_id);
      CREATE INDEX IF NOT EXISTS idx_consolidations_type ON consolidations(entity_type);
      CREATE INDEX IF NOT EXISTS idx_files_archived ON files(archived_at);
      CREATE INDEX IF NOT EXISTS idx_decisions_archived ON decisions(archived_at);
      CREATE INDEX IF NOT EXISTS idx_issues_archived ON issues(archived_at);
      CREATE INDEX IF NOT EXISTS idx_learnings_archived ON learnings(archived_at);

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('consolidation_enabled', 'true');
    `,
    validate: (db) => {
      const exists = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='consolidations'`)
        .get();
      return !!exists;
    },
  },
  // Version 15: Project Rename History
  {
    version: 15,
    name: "project_rename_history",
    description: "Track previous project paths/names so renames preserve context lineage",
    up: `
      ALTER TABLE projects ADD COLUMN previous_paths TEXT DEFAULT '[]';
    `,
    validate: (db) => {
      const col = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('projects') WHERE name = 'previous_paths'`)
        .get();
      return !!col;
    },
  },
  // Version 16: Insight Auto-Dismiss
  {
    version: 16,
    name: "insight_auto_dismiss",
    description: "Track how many times insights are shown to auto-dismiss stale ones",
    up: `
      ALTER TABLE insights ADD COLUMN shown_count INTEGER DEFAULT 0;
    `,
    validate: (db) => {
      const col = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('insights') WHERE name = 'shown_count'`)
        .get();
      return !!col;
    },
  },

  // Version 17: Foundational Learnings with Review Cycle
  {
    version: 17,
    name: "foundational_learnings",
    description: "Add foundational flag and review cycle for important learnings that should be periodically validated",
    up: `
      ALTER TABLE learnings ADD COLUMN foundational INTEGER DEFAULT 0;
      ALTER TABLE learnings ADD COLUMN review_after_sessions INTEGER;
      ALTER TABLE learnings ADD COLUMN sessions_since_review INTEGER DEFAULT 0;
      ALTER TABLE learnings ADD COLUMN review_status TEXT DEFAULT 'pending';
      ALTER TABLE learnings ADD COLUMN reviewed_at DATETIME;

      CREATE INDEX IF NOT EXISTS idx_learnings_foundational_due
      ON learnings(project_id, foundational, review_status, sessions_since_review);
    `,
    validate: (db) => {
      const col = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('learnings') WHERE name = 'foundational'`)
        .get();
      return !!col;
    },
  },

  // Version 18: Learning Promotion System
  {
    version: 18,
    name: "learning_promotion",
    description: "Add promotion system for graduating stable learnings to CLAUDE.md",
    up: `
      -- Promotion status: not_ready → candidate → promoted (or demoted)
      ALTER TABLE learnings ADD COLUMN promotion_status TEXT DEFAULT 'not_ready';

      -- Track confirmation count (confirms without revision)
      ALTER TABLE learnings ADD COLUMN times_confirmed INTEGER DEFAULT 0;

      -- When and where promoted
      ALTER TABLE learnings ADD COLUMN promoted_at DATETIME;
      ALTER TABLE learnings ADD COLUMN promoted_to_section TEXT;

      -- Index for finding promotion candidates efficiently
      CREATE INDEX IF NOT EXISTS idx_learnings_promotion
      ON learnings(project_id, promotion_status, foundational, confidence);
    `,
    validate: (db) => {
      const col = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('learnings') WHERE name = 'promotion_status'`)
        .get();
      return !!col;
    },
  },

  // Version 19: Conversation History Import
  {
    version: 19,
    name: "conversation_history",
    description: "Add tables for imported conversation history (ChatGPT, Claude)",
    up: `
      -- Main conversations table (global, not project-scoped)
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        external_id TEXT,
        title TEXT,
        started_at TEXT,
        ended_at TEXT,
        participant_model TEXT,
        message_count INTEGER DEFAULT 0,
        user_message_count INTEGER DEFAULT 0,
        assistant_message_count INTEGER DEFAULT 0,
        total_chars INTEGER DEFAULT 0,
        tags TEXT,
        notes TEXT,
        extraction_status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source, external_id)
      );

      CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conv_started ON conversations(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conv_title ON conversations(title);

      -- Individual messages
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        timestamp TEXT,
        model TEXT,
        char_count INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_msg_conv ON conversation_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_msg_conv_idx ON conversation_messages(conversation_id, message_index);

      -- FTS for message search
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_conversation_messages USING fts5(
        content,
        content='conversation_messages',
        content_rowid='id'
      );

      -- FTS sync triggers
      CREATE TRIGGER IF NOT EXISTS conversation_messages_ai AFTER INSERT ON conversation_messages BEGIN
        INSERT INTO fts_conversation_messages(rowid, content) VALUES (NEW.id, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS conversation_messages_ad AFTER DELETE ON conversation_messages BEGIN
        INSERT INTO fts_conversation_messages(fts_conversation_messages, rowid, content)
        VALUES('delete', OLD.id, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS conversation_messages_au AFTER UPDATE ON conversation_messages BEGIN
        INSERT INTO fts_conversation_messages(fts_conversation_messages, rowid, content)
        VALUES('delete', OLD.id, OLD.content);
        INSERT INTO fts_conversation_messages(rowid, content) VALUES (NEW.id, NEW.content);
      END;

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('conversation_history_enabled', 'true');
    `,
    validate: (db) => {
      const conv = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
        )
        .get();
      const msgs = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_messages'"
        )
        .get();
      return !!conv && !!msgs;
    },
  },

  // Version 20: Conversation extraction linking table
  {
    version: 20,
    name: "conversation_extracts",
    description: "Add linking table for knowledge extracted from conversations",
    up: `
      -- Linking table: what was extracted from which conversation
      CREATE TABLE IF NOT EXISTS conversation_extracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,        -- 'learning' | 'decision' | 'issue' | 'preference'
        entity_id INTEGER NOT NULL,       -- ID in target table
        confidence REAL,                  -- 0-1 extraction confidence
        excerpt TEXT,                     -- Source quote from conversation
        extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_extract_conv ON conversation_extracts(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_extract_entity ON conversation_extracts(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_extract_type ON conversation_extracts(entity_type);

      -- Add project linking to extracted entities
      ALTER TABLE conversations ADD COLUMN project_id INTEGER REFERENCES projects(id);
      CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_id);

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('conversation_extracts_enabled', 'true');
    `,
    validate: (db) => {
      const table = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_extracts'"
        )
        .get();
      return !!table;
    },
  },

  // Version 21: Pattern tracking and reflection questions
  {
    version: 21,
    name: "pattern_tracking",
    description: "Pattern instances and reflection questions for conversation analysis",
    up: `
      -- Pattern instances (aggregated patterns across conversations)
      CREATE TABLE IF NOT EXISTS pattern_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        pattern_type TEXT NOT NULL,           -- 'preference'|'principle'|'pattern'|'gotcha'|'contradiction'
        title TEXT NOT NULL,                  -- Human-readable pattern name
        description TEXT,                     -- Pattern explanation
        entity_refs TEXT,                     -- JSON: [{entity_type, entity_id}, ...]
        conversation_ids TEXT,                -- JSON: [conv_id, ...]
        aggregate_confidence REAL DEFAULT 0,
        frequency INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active',         -- 'active'|'dismissed'|'confirmed'
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_pattern_type ON pattern_instances(pattern_type);
      CREATE INDEX IF NOT EXISTS idx_pattern_project ON pattern_instances(project_id);
      CREATE INDEX IF NOT EXISTS idx_pattern_status ON pattern_instances(status);
      CREATE INDEX IF NOT EXISTS idx_pattern_frequency ON pattern_instances(frequency DESC);

      -- Reflection questions generated from patterns
      CREATE TABLE IF NOT EXISTS reflection_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        pattern_id INTEGER REFERENCES pattern_instances(id),
        question_type TEXT NOT NULL,          -- 'pattern'|'contradiction'|'validation'|'synthesis'
        question TEXT NOT NULL,
        context TEXT,                         -- Additional context for the question
        source_entities TEXT,                 -- JSON: [{entity_type, entity_id}, ...]
        conversation_ids TEXT,                -- JSON: conversations involved
        confidence REAL,
        status TEXT DEFAULT 'open',           -- 'open'|'answered'|'dismissed'
        answer TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        answered_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_reflection_status ON reflection_questions(status);
      CREATE INDEX IF NOT EXISTS idx_reflection_type ON reflection_questions(question_type);
      CREATE INDEX IF NOT EXISTS idx_reflection_project ON reflection_questions(project_id);

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES ('pattern_tracking_enabled', 'true');
    `,
    validate: (db) => {
      const patterns = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pattern_instances'"
        )
        .get();
      const questions = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='reflection_questions'"
        )
        .get();
      return !!patterns && !!questions;
    },
  },

  // Version 22: Context Enrichment Layer
  {
    version: 22,
    name: "context_enrichment",
    description: "Tables for automatic context enrichment, pending approvals, and metrics",
    up: `
      -- Pending approvals for blocked operations (high-fragility file edits)
      CREATE TABLE IF NOT EXISTS pending_approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT UNIQUE NOT NULL,    -- Unique ID for this operation (e.g., op_abc123)
        tool TEXT NOT NULL,                   -- Edit, Write, Bash, etc.
        file_path TEXT,                       -- File being modified (if applicable)
        reason TEXT NOT NULL,                 -- Why this operation was blocked
        block_level TEXT NOT NULL,            -- 'warn', 'soft', 'hard'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,                  -- Auto-expire old approvals
        approved_at DATETIME                  -- NULL until approved
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_operation ON pending_approvals(operation_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_file ON pending_approvals(file_path);
      CREATE INDEX IF NOT EXISTS idx_approvals_expires ON pending_approvals(expires_at);

      -- Enrichment metrics for performance monitoring and optimization
      CREATE TABLE IF NOT EXISTS enrichment_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool TEXT NOT NULL,                   -- Which tool was enriched
        file_path TEXT,                       -- Primary file involved
        latency_ms INTEGER NOT NULL,          -- How long enrichment took
        enrichers_used TEXT,                  -- JSON array of enricher names
        tokens_injected INTEGER,              -- Approximate tokens in output
        blocked INTEGER DEFAULT 0,            -- Whether operation was blocked
        cache_hits INTEGER DEFAULT 0,         -- Cache hits during enrichment
        cache_misses INTEGER DEFAULT 0,       -- Cache misses during enrichment
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_enrichment_tool ON enrichment_metrics(tool);
      CREATE INDEX IF NOT EXISTS idx_enrichment_time ON enrichment_metrics(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_enrichment_latency ON enrichment_metrics(latency_ms);

      -- Auto-cleanup: keep last 10000 metrics
      CREATE TRIGGER IF NOT EXISTS enrichment_metrics_cleanup
      AFTER INSERT ON enrichment_metrics
      BEGIN
        DELETE FROM enrichment_metrics
        WHERE id NOT IN (
          SELECT id FROM enrichment_metrics ORDER BY created_at DESC LIMIT 10000
        );
      END;

      -- Auto-cleanup: expire old pending approvals
      CREATE TRIGGER IF NOT EXISTS pending_approvals_cleanup
      AFTER INSERT ON pending_approvals
      BEGIN
        DELETE FROM pending_approvals
        WHERE expires_at IS NOT NULL AND expires_at < datetime('now');
      END;

      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES
        ('context_enrichment_enabled', 'true'),
        ('pending_approvals_enabled', 'true'),
        ('enrichment_metrics_enabled', 'true');
    `,
    validate: (db) => {
      const approvals = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_approvals'"
        )
        .get();
      const metrics = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='enrichment_metrics'"
        )
        .get();
      return !!approvals && !!metrics;
    },
  },

  // Version 23: Continuous Learning System
  {
    version: 23,
    name: "continuous_learning",
    description: "Confidence decay, decision-learning feedback loop, contradiction detection, and learning versioning",
    up: `
      -- ========================================================================
      -- CONFIDENCE DECAY & REINFORCEMENT
      -- Knowledge fades unless reinforced, like human memory
      -- ========================================================================

      -- Add decay columns to learnings
      ALTER TABLE learnings ADD COLUMN last_reinforced_at TEXT;
      ALTER TABLE learnings ADD COLUMN decay_rate REAL DEFAULT 0.05;

      -- Initialize last_reinforced_at to last_applied or created_at
      UPDATE learnings SET last_reinforced_at = COALESCE(last_applied, created_at);

      -- Index for efficient decay queries
      CREATE INDEX IF NOT EXISTS idx_learnings_reinforcement
      ON learnings(project_id, last_reinforced_at, confidence);

      -- ========================================================================
      -- DECISION-LEARNING FEEDBACK LOOP
      -- Track which learnings influenced which decisions
      -- ========================================================================

      CREATE TABLE IF NOT EXISTS decision_learnings (
        decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        learning_id INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
        contribution TEXT NOT NULL DEFAULT 'influenced', -- 'influenced', 'contradicted', 'ignored'
        linked_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (decision_id, learning_id)
      );

      CREATE INDEX IF NOT EXISTS idx_decision_learnings_decision ON decision_learnings(decision_id);
      CREATE INDEX IF NOT EXISTS idx_decision_learnings_learning ON decision_learnings(learning_id);
      CREATE INDEX IF NOT EXISTS idx_decision_learnings_contribution ON decision_learnings(contribution);

      -- ========================================================================
      -- CONTRADICTION DETECTION
      -- Flag when learnings conflict with each other
      -- ========================================================================

      CREATE TABLE IF NOT EXISTS learning_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        learning_a INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
        learning_b INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
        conflict_type TEXT NOT NULL DEFAULT 'potential', -- 'direct', 'conditional', 'scope', 'potential'
        similarity_score REAL,                  -- Embedding similarity if available
        detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        resolution TEXT,                        -- 'a_supersedes', 'b_supersedes', 'both_valid_conditionally', 'merged', 'dismissed'
        resolution_notes TEXT,
        UNIQUE(learning_a, learning_b)
      );

      CREATE INDEX IF NOT EXISTS idx_conflicts_unresolved ON learning_conflicts(resolved_at) WHERE resolved_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_conflicts_learning_a ON learning_conflicts(learning_a);
      CREATE INDEX IF NOT EXISTS idx_conflicts_learning_b ON learning_conflicts(learning_b);

      -- ========================================================================
      -- LEARNING VERSIONING
      -- Track how understanding evolves over time
      -- ========================================================================

      CREATE TABLE IF NOT EXISTS learning_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        learning_id INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        confidence INTEGER,
        changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        change_reason TEXT                      -- 'revision', 'confirmation', 'decay_reset'
      );

      CREATE INDEX IF NOT EXISTS idx_versions_learning ON learning_versions(learning_id, version DESC);

      -- Record migration
      INSERT OR REPLACE INTO _migration_meta (key, value)
      VALUES
        ('continuous_learning_enabled', 'true'),
        ('confidence_decay_enabled', 'true'),
        ('decision_learning_links_enabled', 'true'),
        ('contradiction_detection_enabled', 'true'),
        ('learning_versioning_enabled', 'true');
    `,
    validate: (db) => {
      // Check decay columns exist
      const decayCol = db
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('learnings') WHERE name='decay_rate'`)
        .get();

      // Check decision_learnings table exists
      const linksExist = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='decision_learnings'`)
        .get();

      // Check learning_conflicts table exists
      const conflictsExist = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='learning_conflicts'`)
        .get();

      // Check learning_versions table exists
      const versionsExist = db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='learning_versions'`)
        .get();

      return !!decayCol && !!linksExist && !!conflictsExist && !!versionsExist;
    },
  },
];

// ============================================================================
// Version Management
// ============================================================================

/**
 * Get current schema version from PRAGMA user_version
 */
export function getSchemaVersion(db: Database): number {
  const result = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
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
  return MIGRATIONS.filter((m) => m.version > currentVersion);
}

// ============================================================================
// Migration Runner
// ============================================================================

/**
 * Apply a single migration atomically
 */
function applyMigration(db: Database, migration: Migration, dbPath: string): Result<MigrationResult> {
  const startTime = Date.now();

  logMigration(dbPath, migration.version, migration.name, "start");

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
        db.run(`INSERT OR REPLACE INTO _migration_history (version, name, duration_ms) VALUES (?, ?, ?)`, [
          migration.version,
          migration.name,
          Date.now() - startTime,
        ]);
      } catch {
        // History table might not exist yet (for early migrations)
      }

      db.exec("COMMIT");

      const duration = Date.now() - startTime;
      logMigration(dbPath, migration.version, migration.name, "success");

      return ok({
        version: migration.version,
        name: migration.name,
        status: "applied",
        duration_ms: duration,
      });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMigration(dbPath, migration.version, migration.name, "failed", message);

    return err(
      new ContextError(`Migration ${migration.version} (${migration.name}) failed: ${message}`, "DB_QUERY_ERROR", {
        version: migration.version,
        name: migration.name,
      })
    );
  }
}

/**
 * Apply all pending migrations
 */
export function runMigrations(db: Database, dbPath: string = "unknown"): Result<MigrationState> {
  const currentVersion = getSchemaVersion(db);
  const pending = getPendingMigrations(db);
  const results: MigrationResult[] = [];

  if (pending.length === 0) {
    return ok({
      current_version: currentVersion,
      latest_version: getLatestVersion(),
      pending_count: 0,
      applied: [],
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
    applied: results,
  });
}

// ============================================================================
// Integrity Checking
// ============================================================================

// Tables required in project databases
const REQUIRED_PROJECT_TABLES = [
  "projects",
  "files",
  "symbols",
  "decisions",
  "issues",
  "sessions",
  "learnings",
  "relationships",
  "bookmarks",
  "focus",
  "file_correlations",
  "session_learnings",
  "blast_radius",
  "blast_summary",
  "observations",
  "open_questions",
  "workflow_patterns",
  "developer_profile",
  "insights",
];

// Combined for reference
const REQUIRED_TABLES = REQUIRED_PROJECT_TABLES;

const REQUIRED_INDEXES = [
  "idx_files_project",
  "idx_files_fragility",
  "idx_decisions_project",
  "idx_issues_project",
  "idx_sessions_project",
  "idx_learnings_project",
];

const REQUIRED_FTS_TABLES = ["fts_files", "fts_symbols", "fts_decisions", "fts_issues", "fts_learnings"];

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
    const integrityResult = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
    if (integrityResult?.integrity_check !== "ok") {
      issues.push(`SQLite integrity check failed: ${integrityResult?.integrity_check}`);
    }
  } catch (error) {
    issues.push(`Failed to run integrity check: ${error}`);
  }

  // Check required tables
  for (const table of REQUIRED_TABLES) {
    const exists = db
      .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    tables.push({ name: table, exists: !!exists });
    if (!exists) {
      issues.push(`Missing required table: ${table}`);
    }
  }

  // Check FTS tables
  for (const fts of REQUIRED_FTS_TABLES) {
    const exists = db
      .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(fts);
    tables.push({ name: fts, exists: !!exists });
    if (!exists) {
      issues.push(`Missing FTS table: ${fts}`);
    }
  }

  // Check required indexes
  for (const index of REQUIRED_INDEXES) {
    const exists = db
      .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(index);
    indexes.push({ name: index, exists: !!exists });
    if (!exists) {
      issues.push(`Missing required index: ${index}`);
    }
  }

  // Check foreign keys are enabled
  const fkResult = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
  if (fkResult?.foreign_keys !== 1) {
    issues.push("Foreign keys are not enabled");
  }

  // Check WAL mode
  const journalResult = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
  if (journalResult?.journal_mode !== "wal") {
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
    indexes,
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
    const errorCode = error instanceof ContextError ? error.code : "UNKNOWN_ERROR";

    db.run(`INSERT INTO _error_log (source, error_code, message, context, stack) VALUES (?, ?, ?, ?, ?)`, [
      source,
      errorCode,
      message,
      context ? JSON.stringify(context) : null,
      stack ?? null,
    ]);
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
    return db
      .query<
        {
          id: number;
          timestamp: string;
          source: string;
          error_code: string | null;
          message: string;
        },
        [number]
      >(
        `SELECT id, timestamp, source, error_code, message
       FROM _error_log
       ORDER BY timestamp DESC
       LIMIT ?`
      )
      .all(limit);
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
  db.exec("PRAGMA synchronous = NORMAL"); // Good balance of safety and speed
  db.exec("PRAGMA cache_size = -64000"); // 64MB cache
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
