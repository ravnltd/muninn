/**
 * Unified Context Router — Data Collectors
 *
 * Shared database query functions used by intent handlers.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import type { ContextFileInfo, UnifiedContextResult } from "./types.js";

// ============================================================================
// File Collectors
// ============================================================================

export async function collectFileInfo(
  db: DatabaseAdapter,
  projectId: number,
  files: string[],
  result: UnifiedContextResult,
): Promise<void> {
  for (const filePath of files.slice(0, 20)) {
    try {
      const file = await db.get<{
        path: string;
        fragility: number;
        purpose: string | null;
        fragility_signals: string | null;
      }>(
        `SELECT path, fragility, purpose, fragility_signals FROM files
         WHERE project_id = ? AND path = ? AND archived_at IS NULL`,
        [projectId, filePath],
      );

      if (file) {
        const info: ContextFileInfo = {
          path: file.path,
          fragility: file.fragility,
          purpose: file.purpose ?? undefined,
        };
        result.files.push(info);

        if (file.fragility >= 7) {
          result.warnings.push({
            type: "fragility",
            severity: file.fragility >= 9 ? "critical" : "warning",
            message: `Fragility ${file.fragility}/10${file.fragility_signals ? ` — ${file.fragility_signals}` : ""}`,
            file: file.path,
          });
        }
      }
    } catch {
      // File not in database — skip
    }
  }
}

export async function collectTestHistory(
  db: DatabaseAdapter,
  projectId: number,
  files: string[],
  result: UnifiedContextResult,
): Promise<void> {
  for (const filePath of files.slice(0, 10)) {
    try {
      const testHistory = await db.get<{
        total: number;
        failures: number;
      }>(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures
         FROM test_results
         WHERE project_id = ?
         AND output_summary LIKE ?
         AND created_at > datetime('now', '-30 days')`,
        [projectId, `%${filePath.split("/").pop()}%`],
      );

      if (testHistory && testHistory.total > 0 && testHistory.failures > 0) {
        const rate = testHistory.failures / testHistory.total;
        const existing = result.files.find((f) => f.path === filePath);
        if (existing) {
          existing.historicalFailureRate = Math.round(rate * 100) / 100;
        }
        if (rate > 0.3) {
          result.warnings.push({
            type: "test_failure",
            severity: rate > 0.5 ? "warning" : "info",
            message: `${Math.round(rate * 100)}% test failure rate in last 30 days`,
            file: filePath,
          });
        }
      }
    } catch {
      // test_results table may not exist
    }
  }
}

export async function collectCochangers(
  db: DatabaseAdapter,
  projectId: number,
  files: string[],
  result: UnifiedContextResult,
): Promise<void> {
  for (const filePath of files.slice(0, 10)) {
    try {
      const cochangers = await db.all<{ file_b: string; cochange_count: number }>(
        `SELECT file_b, cochange_count FROM file_correlations
         WHERE project_id = ? AND file_a = ? AND cochange_count >= 2
         ORDER BY cochange_count DESC LIMIT 5`,
        [projectId, filePath],
      );

      if (cochangers.length > 0) {
        const existing = result.files.find((f) => f.path === filePath);
        if (existing) {
          existing.cochangers = cochangers.map((c) => c.file_b);
        }
      }
    } catch {
      // file_correlations table may not exist
    }
  }
}

// ============================================================================
// Decision & Contradiction Collectors
// ============================================================================

export async function collectContradictions(
  db: DatabaseAdapter,
  projectId: number,
  result: UnifiedContextResult,
): Promise<void> {
  try {
    const contradictions = await db.all<{
      contradiction_summary: string;
      severity: string;
      source_type: string;
    }>(
      `SELECT contradiction_summary, severity, source_type FROM contradiction_alerts
       WHERE project_id = ? AND dismissed = 0
       ORDER BY created_at DESC LIMIT 3`,
      [projectId],
    );

    for (const c of contradictions) {
      result.warnings.push({
        type: "contradiction",
        severity: c.severity === "critical" ? "critical" : "warning",
        message: `${c.source_type}: ${c.contradiction_summary}`,
      });
    }
  } catch {
    // Table may not exist
  }
}

export async function collectFailedDecisions(
  db: DatabaseAdapter,
  projectId: number,
  result: UnifiedContextResult,
): Promise<void> {
  try {
    const failed = await db.all<{
      title: string;
      decision: string;
      outcome: string;
      outcome_notes: string | null;
    }>(
      `SELECT title, decision, outcome, outcome_notes FROM decisions
       WHERE project_id = ? AND outcome IN ('failed', 'revised') AND archived_at IS NULL
       ORDER BY updated_at DESC LIMIT 5`,
      [projectId],
    );

    for (const d of failed) {
      result.warnings.push({
        type: "failed_decision",
        severity: d.outcome === "failed" ? "critical" : "warning",
        message: d.title,
      });
      result.context.push({
        type: "decision",
        title: d.title,
        content: d.decision,
        status: d.outcome,
      });
    }
  } catch {
    // Table may not exist
  }
}

export async function collectFileDecisions(
  db: DatabaseAdapter,
  projectId: number,
  files: string[],
  result: UnifiedContextResult,
): Promise<void> {
  try {
    for (const filePath of files.slice(0, 5)) {
      const decisions = await db.all<{
        title: string;
        decision: string;
        outcome: string | null;
        confidence: number;
      }>(
        `SELECT title, decision, outcome, confidence FROM decisions
         WHERE project_id = ? AND archived_at IS NULL
         AND (affects LIKE ? OR title LIKE ?)
         ORDER BY confidence DESC LIMIT 3`,
        [projectId, `%${filePath}%`, `%${filePath.split("/").pop()?.replace(/\.[^.]+$/, "")}%`],
      );

      for (const d of decisions) {
        if (!result.context.some((c) => c.title === d.title)) {
          result.context.push({
            type: "decision",
            title: d.title,
            content: d.decision,
            confidence: d.confidence,
            status: d.outcome ?? "pending",
          });
        }
      }
    }
  } catch {
    // Table may not exist
  }
}

// ============================================================================
// Learning & Issue Collectors
// ============================================================================

export async function collectFileLearnings(
  db: DatabaseAdapter,
  projectId: number,
  files: string[],
  result: UnifiedContextResult,
): Promise<void> {
  try {
    for (const filePath of files.slice(0, 5)) {
      const learnings = await db.all<{
        title: string;
        content: string;
        category: string | null;
        confidence: number;
      }>(
        `SELECT title, content, category, confidence FROM learnings
         WHERE project_id = ? AND archived_at IS NULL
         AND (files LIKE ? OR title LIKE ? OR content LIKE ?)
         AND confidence >= 3
         ORDER BY confidence DESC LIMIT 3`,
        [
          projectId,
          `%${filePath}%`,
          `%${filePath.split("/").pop()?.replace(/\.[^.]+$/, "")}%`,
          `%${filePath.split("/").pop()?.replace(/\.[^.]+$/, "")}%`,
        ],
      );

      for (const l of learnings) {
        if (!result.context.some((c) => c.title === l.title)) {
          result.context.push({
            type: "learning",
            title: l.title,
            content: l.content,
            confidence: l.confidence,
          });
        }
      }
    }
  } catch {
    // Table may not exist
  }
}

export async function collectFileIssues(
  db: DatabaseAdapter,
  projectId: number,
  files: string[],
  result: UnifiedContextResult,
): Promise<void> {
  try {
    for (const filePath of files.slice(0, 5)) {
      const issues = await db.all<{
        title: string;
        description: string | null;
        severity: number;
        type: string | null;
      }>(
        `SELECT title, description, severity, type FROM issues
         WHERE project_id = ? AND status = 'open'
         AND (title LIKE ? OR description LIKE ?)
         ORDER BY severity DESC LIMIT 3`,
        [
          projectId,
          `%${filePath.split("/").pop()?.replace(/\.[^.]+$/, "")}%`,
          `%${filePath.split("/").pop()?.replace(/\.[^.]+$/, "")}%`,
        ],
      );

      for (const i of issues) {
        if (!result.context.some((c) => c.title === i.title)) {
          result.context.push({
            type: "issue",
            title: i.title,
            content: i.description ?? i.title,
            confidence: i.severity,
          });
        }
      }
    }
  } catch {
    // Table may not exist
  }
}

export async function collectOpenIssues(
  db: DatabaseAdapter,
  projectId: number,
  result: UnifiedContextResult,
): Promise<void> {
  try {
    const issues = await db.all<{
      title: string;
      description: string | null;
      severity: number;
      type: string | null;
    }>(
      `SELECT title, description, severity, type FROM issues
       WHERE project_id = ? AND status = 'open'
       ORDER BY severity DESC LIMIT 5`,
      [projectId],
    );

    for (const i of issues) {
      if (!result.context.some((c) => c.title === i.title)) {
        result.context.push({
          type: "issue",
          title: i.title,
          content: i.description ?? i.title,
          confidence: i.severity,
        });
      }
    }
  } catch {
    // Table may not exist
  }
}

// ============================================================================
// Error Collectors
// ============================================================================

export async function collectErrorFixes(
  db: DatabaseAdapter,
  projectId: number,
  query: string,
  result: UnifiedContextResult,
): Promise<void> {
  try {
    const fixes = await db.all<{
      error_signature: string;
      fix_description: string | null;
      fix_files: string | null;
      confidence: number;
    }>(
      `SELECT error_signature, fix_description, fix_files, confidence
       FROM error_fix_pairs
       WHERE project_id = ? AND confidence >= 0.4
       AND (error_signature LIKE ? OR fix_description LIKE ?)
       ORDER BY confidence DESC, last_seen_at DESC LIMIT 5`,
      [projectId, `%${query.slice(0, 50)}%`, `%${query.slice(0, 50)}%`],
    );

    for (const f of fixes) {
      result.context.push({
        type: "error_fix",
        title: f.error_signature.slice(0, 60),
        content: f.fix_description ?? "See fix files",
        confidence: f.confidence,
      });
    }
  } catch {
    // Table may not exist
  }
}

export async function collectRecentErrors(
  db: DatabaseAdapter,
  projectId: number,
  result: UnifiedContextResult,
): Promise<void> {
  try {
    const errors = await db.all<{
      error_type: string;
      error_message: string;
      source_file: string | null;
    }>(
      `SELECT error_type, error_message, source_file FROM error_events
       WHERE project_id = ?
       ORDER BY created_at DESC LIMIT 5`,
      [projectId],
    );

    for (const e of errors) {
      result.warnings.push({
        type: "test_failure",
        severity: "info",
        message: `${e.error_type}: ${e.error_message.slice(0, 80)}`,
        file: e.source_file ?? undefined,
      });
    }
  } catch {
    // Table may not exist
  }
}

// ============================================================================
// Query & Suggestion Collectors
// ============================================================================

export async function collectQueryResults(
  db: DatabaseAdapter,
  projectId: number,
  query: string,
  result: UnifiedContextResult,
): Promise<void> {
  // Search decisions via FTS
  try {
    const decisions = await db.all<{
      title: string;
      decision: string;
      outcome: string | null;
      confidence: number;
    }>(
      `SELECT d.title, d.decision, d.outcome, d.confidence
       FROM decisions d
       JOIN fts_decisions ft ON d.id = ft.rowid
       WHERE ft.fts_decisions MATCH ? AND d.project_id = ? AND d.archived_at IS NULL
       ORDER BY d.confidence DESC LIMIT 5`,
      [sanitizeFtsQuery(query), projectId],
    );

    for (const d of decisions) {
      if (!result.context.some((c) => c.title === d.title)) {
        result.context.push({
          type: "decision",
          title: d.title,
          content: d.decision,
          confidence: d.confidence,
          status: d.outcome ?? "pending",
        });
      }
    }
  } catch {
    // FTS table may not exist
  }

  // Search learnings via FTS
  try {
    const learnings = await db.all<{
      title: string;
      content: string;
      category: string | null;
      confidence: number;
    }>(
      `SELECT l.title, l.content, l.category, l.confidence
       FROM learnings l
       JOIN fts_learnings ft ON l.id = ft.rowid
       WHERE ft.fts_learnings MATCH ? AND l.project_id = ? AND l.archived_at IS NULL
       AND l.confidence >= 3
       ORDER BY l.confidence DESC LIMIT 5`,
      [sanitizeFtsQuery(query), projectId],
    );

    for (const l of learnings) {
      if (!result.context.some((c) => c.title === l.title)) {
        result.context.push({
          type: "learning",
          title: l.title,
          content: l.content,
          confidence: l.confidence,
        });
      }
    }
  } catch {
    // FTS table may not exist
  }
}

export async function collectSuggestedFiles(
  db: DatabaseAdapter,
  projectId: number,
  task: string,
  result: UnifiedContextResult,
): Promise<void> {
  try {
    const files = await db.all<{
      path: string;
      fragility: number;
      purpose: string | null;
    }>(
      `SELECT f.path, f.fragility, f.purpose
       FROM files f
       JOIN fts_files ft ON f.id = ft.rowid
       WHERE ft.fts_files MATCH ? AND f.project_id = ? AND f.archived_at IS NULL
       ORDER BY f.fragility DESC LIMIT 10`,
      [sanitizeFtsQuery(task), projectId],
    );

    for (const f of files) {
      if (!result.files.some((existing) => existing.path === f.path)) {
        result.files.push({
          path: f.path,
          fragility: f.fragility,
          purpose: f.purpose ?? undefined,
        });
      }
    }
  } catch {
    // FTS table may not exist
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sanitize a query string for FTS5 MATCH.
 * Removes special characters and wraps terms for prefix matching.
 */
export function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special chars, keep alphanumeric and spaces
  const cleaned = query.replace(/[^a-zA-Z0-9\s_-]/g, " ").trim();
  if (!cleaned) return '""';

  // Split into terms and join with OR for broader matching
  const terms = cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 5);

  if (terms.length === 0) return '""';

  // Use prefix matching for each term
  return terms.map((t) => `"${t}"*`).join(" OR ");
}
