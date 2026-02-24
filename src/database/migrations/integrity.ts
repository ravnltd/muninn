/**
 * Database Integrity Checking and Error Logging
 */
import type { Database } from "bun:sqlite";
import { ContextError } from "../../utils/errors";
import { getLatestVersion, getSchemaVersion } from "./runner.js";
import type { IntegrityCheck } from "./types.js";

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
  "tool_calls",
  "error_events",
  "git_commits",
  "work_queue",
  "diff_analyses",
  "error_fix_pairs",
  "context_injections",
  "call_graph",
  "test_source_map",
  "test_results",
  "revert_events",
  "retrieval_feedback",
  "code_ownership",
  "team_learnings",
  "pr_review_extracts",
  "onboarding_contexts",
  "budget_recommendations",
  "contradiction_alerts",
  "value_metrics",
  "health_score_history",
  "archived_knowledge",
  "risk_alerts",
  "codebase_dna",
  "reasoning_traces",
  "strategy_catalog",
  "workflow_predictions",
  "impact_tracking",
  "ab_tests",
  "knowledge_freshness",
  "agent_intents",
  "agent_profiles",
  "agent_handoffs",
  "agent_scratchpad",
];

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

export function checkIntegrity(db: Database): IntegrityCheck {
  const version = getSchemaVersion(db);
  const issues: string[] = [];
  const tables: { name: string; exists: boolean }[] = [];
  const indexes: { name: string; exists: boolean }[] = [];

  try {
    const integrityResult = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
    if (integrityResult?.integrity_check !== "ok") {
      issues.push(`SQLite integrity check failed: ${integrityResult?.integrity_check}`);
    }
  } catch (error) {
    issues.push(`Failed to run integrity check: ${error}`);
  }

  for (const table of REQUIRED_TABLES) {
    const exists = db
      .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    tables.push({ name: table, exists: !!exists });
    if (!exists) {
      issues.push(`Missing required table: ${table}`);
    }
  }

  for (const fts of REQUIRED_FTS_TABLES) {
    const exists = db
      .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(fts);
    tables.push({ name: fts, exists: !!exists });
    if (!exists) {
      issues.push(`Missing FTS table: ${fts}`);
    }
  }

  for (const index of REQUIRED_INDEXES) {
    const exists = db
      .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(index);
    indexes.push({ name: index, exists: !!exists });
    if (!exists) {
      issues.push(`Missing required index: ${index}`);
    }
  }

  const fkResult = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
  if (fkResult?.foreign_keys !== 1) {
    issues.push("Foreign keys are not enabled");
  }

  const journalResult = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
  if (journalResult?.journal_mode !== "wal") {
    issues.push(`Journal mode is ${journalResult?.journal_mode}, expected WAL`);
  }

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

export function logDbError(
  db: Database,
  source: string,
  error: Error | string,
  context?: Record<string, unknown>,
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

export function getRecentErrors(
  db: Database,
  limit: number = 50,
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
       LIMIT ?`,
      )
      .all(limit);
  } catch {
    return [];
  }
}
