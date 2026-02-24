/**
 * Knowledge Freshness Tracker — v7 Phase 4C
 *
 * Staleness score = days_since_validated / 30 * (1 + deps_changed_count * 0.2)
 *
 * When package.json/lock files change, flags tech decisions as potentially stale.
 * Items with staleness > 0.7 get [possibly stale] tag in context output.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface FreshnessRecord {
  sourceTable: string;
  sourceId: number;
  stalenessScore: number;
  flaggedStale: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const STALE_THRESHOLD = 0.7;
const VALIDATION_WINDOW_DAYS = 30;
const PACKAGE_FILES = ["package.json", "package-lock.json", "bun.lockb", "yarn.lock", "pnpm-lock.yaml"];

// ============================================================================
// Main
// ============================================================================

/**
 * Check and update knowledge freshness for a project.
 * Runs after git commit processing.
 */
export async function checkKnowledgeFreshness(
  db: DatabaseAdapter,
  projectId: number,
): Promise<{ checked: number; flagged: number }> {
  let checked = 0;
  let flagged = 0;

  // Check decisions
  try {
    const decisions = await db.all<{
      id: number;
      updated_at: string | null;
      created_at: string;
    }>(
      `SELECT id, updated_at, created_at FROM decisions
       WHERE project_id = ? AND archived_at IS NULL AND outcome NOT IN ('failed')`,
      [projectId],
    );

    for (const d of decisions) {
      const staleness = computeStaleness(d.updated_at ?? d.created_at);
      await upsertFreshness(db, projectId, "decisions", d.id, staleness);
      checked++;
      if (staleness > STALE_THRESHOLD) flagged++;
    }
  } catch {
    // Table may not exist
  }

  // Check learnings
  try {
    const learnings = await db.all<{
      id: number;
      last_reinforced_at: string | null;
      created_at: string;
    }>(
      `SELECT id, last_reinforced_at, created_at FROM learnings
       WHERE project_id = ? AND archived_at IS NULL`,
      [projectId],
    );

    for (const l of learnings) {
      const staleness = computeStaleness(l.last_reinforced_at ?? l.created_at);
      await upsertFreshness(db, projectId, "learnings", l.id, staleness);
      checked++;
      if (staleness > STALE_THRESHOLD) flagged++;
    }
  } catch {
    // Table may not exist
  }

  return { checked, flagged };
}

/**
 * Flag tech decisions as stale when dependency files change.
 * Called when package.json or lock files are modified.
 */
export async function flagDependencyDecisions(
  db: DatabaseAdapter,
  projectId: number,
  changedFiles: string[],
): Promise<number> {
  // Check if any package files changed
  const packageChanged = changedFiles.some((f) =>
    PACKAGE_FILES.some((pkg) => f.endsWith(pkg)),
  );

  if (!packageChanged) return 0;

  let flagged = 0;

  try {
    // Find decisions related to dependencies/stack/packages
    const techDecisions = await db.all<{ id: number }>(
      `SELECT id FROM decisions
       WHERE project_id = ? AND archived_at IS NULL
       AND (title LIKE '%depend%' OR title LIKE '%package%' OR title LIKE '%stack%'
            OR title LIKE '%library%' OR title LIKE '%framework%' OR title LIKE '%version%'
            OR decision LIKE '%npm%' OR decision LIKE '%bun%' OR decision LIKE '%yarn%')`,
      [projectId],
    );

    for (const d of techDecisions) {
      await incrementDepsChanged(db, projectId, "decisions", d.id);
      flagged++;
    }
  } catch {
    // Table may not exist
  }

  return flagged;
}

/**
 * Get stale items for context tagging.
 */
export async function getStaleItems(
  db: DatabaseAdapter,
  projectId: number,
  limit: number = 10,
): Promise<FreshnessRecord[]> {
  try {
    const rows = await db.all<{
      source_table: string;
      source_id: number;
      staleness_score: number;
      flagged_stale: number;
    }>(
      `SELECT source_table, source_id, staleness_score, flagged_stale
       FROM knowledge_freshness
       WHERE project_id = ? AND staleness_score > ?
       ORDER BY staleness_score DESC LIMIT ?`,
      [projectId, STALE_THRESHOLD, limit],
    );

    return rows.map((r) => ({
      sourceTable: r.source_table,
      sourceId: r.source_id,
      stalenessScore: r.staleness_score,
      flaggedStale: r.flagged_stale === 1,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// Helpers
// ============================================================================

function computeStaleness(lastValidated: string): number {
  const now = new Date();
  const validated = new Date(lastValidated);
  const daysSince = (now.getTime() - validated.getTime()) / (1000 * 60 * 60 * 24);
  return Math.min(daysSince / VALIDATION_WINDOW_DAYS, 2.0);
}

async function upsertFreshness(
  db: DatabaseAdapter,
  projectId: number,
  sourceTable: string,
  sourceId: number,
  staleness: number,
): Promise<void> {
  const flagged = staleness > STALE_THRESHOLD ? 1 : 0;
  try {
    await db.run(
      `INSERT INTO knowledge_freshness
       (project_id, source_table, source_id, staleness_score, flagged_stale, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_id, source_table, source_id) DO UPDATE SET
         staleness_score = excluded.staleness_score,
         flagged_stale = excluded.flagged_stale,
         updated_at = datetime('now')`,
      [projectId, sourceTable, sourceId, staleness, flagged],
    );
  } catch {
    // Table may not exist
  }
}

async function incrementDepsChanged(
  db: DatabaseAdapter,
  projectId: number,
  sourceTable: string,
  sourceId: number,
): Promise<void> {
  try {
    // Get current record
    const existing = await db.get<{ deps_changed_count: number; staleness_score: number }>(
      `SELECT deps_changed_count, staleness_score FROM knowledge_freshness
       WHERE project_id = ? AND source_table = ? AND source_id = ?`,
      [projectId, sourceTable, sourceId],
    );

    if (existing) {
      const newCount = existing.deps_changed_count + 1;
      // Recalculate staleness with dependency factor
      const baseStaleness = existing.staleness_score / (1 + (existing.deps_changed_count * 0.2));
      const newStaleness = baseStaleness * (1 + newCount * 0.2);
      const flagged = newStaleness > STALE_THRESHOLD ? 1 : 0;

      await db.run(
        `UPDATE knowledge_freshness SET
           deps_changed_count = ?,
           staleness_score = ?,
           flagged_stale = ?,
           updated_at = datetime('now')
         WHERE project_id = ? AND source_table = ? AND source_id = ?`,
        [newCount, newStaleness, flagged, projectId, sourceTable, sourceId],
      );
    } else {
      // Create new record with deps changed
      await db.run(
        `INSERT INTO knowledge_freshness
         (project_id, source_table, source_id, staleness_score, deps_changed_count, flagged_stale)
         VALUES (?, ?, ?, 0.5, 1, 0)`,
        [projectId, sourceTable, sourceId],
      );
    }
  } catch {
    // Table may not exist
  }
}
