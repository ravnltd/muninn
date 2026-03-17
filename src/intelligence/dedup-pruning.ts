/**
 * Deduplication and Pruning
 *
 * Periodic maintenance to keep knowledge base clean:
 * - Deduplicate learnings with very similar titles
 * - Prune stale low-confidence learnings
 * - Prune weak file correlations
 *
 * Runs as part of the reinforce_learnings background job.
 */

import type { DatabaseAdapter } from "../database/adapter.js";

// ============================================================================
// Types
// ============================================================================

interface DedupResult {
  keptId: number;
  mergedId: number;
  title: string;
}

interface PruneResult {
  type: "learning" | "correlation";
  id: number;
  reason: string;
}

interface LearningPair {
  id: number;
  title: string;
  confidence: number;
  times_applied: number;
}

// ============================================================================
// Levenshtein Distance (bounded for performance)
// ============================================================================

/** Compute Levenshtein distance, capped at maxDist for early exit */
function levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;

  const la = a.length;
  const lb = b.length;
  const prev = new Array<number>(lb + 1);
  const curr = new Array<number>(lb + 1);

  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = i;

    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }

    if (rowMin > maxDist) return maxDist + 1;

    // Swap arrays
    for (let j = 0; j <= lb; j++) prev[j] = curr[j];
  }

  return prev[lb];
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Find and merge learnings with very similar titles.
 * Uses FTS to find candidates, then Levenshtein to confirm similarity.
 */
export async function deduplicateLearnings(
  db: DatabaseAdapter,
  projectId: number,
): Promise<DedupResult[]> {
  const results: DedupResult[] = [];

  try {
    // Get all active learnings
    const learnings = await db.all<LearningPair>(
      `SELECT id, title, confidence, times_applied FROM learnings
       WHERE (project_id = ? OR project_id IS NULL)
       AND archived_at IS NULL
       ORDER BY confidence DESC, times_applied DESC
       LIMIT 200`,
      [projectId],
    );

    const merged = new Set<number>();

    for (let i = 0; i < learnings.length; i++) {
      const a = learnings[i];
      if (merged.has(a.id)) continue;

      for (let j = i + 1; j < learnings.length; j++) {
        const b = learnings[j];
        if (merged.has(b.id)) continue;

        // Quick length check before expensive Levenshtein
        const maxLen = Math.max(a.title.length, b.title.length);
        if (maxLen === 0) continue;

        const threshold = Math.ceil(maxLen * 0.2);
        const dist = levenshtein(
          a.title.toLowerCase(),
          b.title.toLowerCase(),
          threshold,
        );

        if (dist <= threshold) {
          // Merge: keep higher-confidence one, sum times_applied
          await db.run(
            `UPDATE learnings SET
               times_applied = times_applied + ?,
               updated_at = datetime('now')
             WHERE id = ?`,
            [b.times_applied, a.id],
          );

          await db.run(
            `UPDATE learnings SET
               archived_at = datetime('now'),
               stage = 'archived',
               updated_at = datetime('now')
             WHERE id = ?`,
            [b.id],
          );

          merged.add(b.id);
          results.push({ keptId: a.id, mergedId: b.id, title: a.title });
        }
      }
    }
  } catch {
    // Best-effort
  }

  return results;
}

// ============================================================================
// Pruning — Stale Learnings
// ============================================================================

/**
 * Archive learnings with low confidence after sufficient sessions.
 */
export async function pruneStaleLearnings(
  db: DatabaseAdapter,
  projectId: number,
): Promise<PruneResult[]> {
  const results: PruneResult[] = [];

  try {
    const stale = await db.all<{ id: number }>(
      `SELECT id FROM learnings
       WHERE (project_id = ? OR project_id IS NULL)
       AND confidence < 2
       AND archived_at IS NULL
       AND created_at < datetime('now', '-60 days')
       LIMIT 20`,
      [projectId],
    );

    // Only prune if there have been enough sessions
    const sessionCount = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?`,
      [projectId],
    );
    if ((sessionCount?.cnt ?? 0) < 20) return results;

    for (const row of stale) {
      await db.run(
        `UPDATE learnings SET
           archived_at = datetime('now'),
           stage = 'archived',
           updated_at = datetime('now')
         WHERE id = ?`,
        [row.id],
      );
      results.push({
        type: "learning",
        id: row.id,
        reason: "Low confidence after 20+ sessions",
      });
    }
  } catch {
    // Best-effort
  }

  return results;
}

// ============================================================================
// Pruning — Weak Correlations
// ============================================================================

/**
 * Delete file_correlations with cochange_count = 1 older than 90 days.
 */
export async function pruneWeakCorrelations(
  db: DatabaseAdapter,
  projectId: number,
): Promise<PruneResult[]> {
  const results: PruneResult[] = [];

  try {
    const weak = await db.all<{ id: number }>(
      `SELECT id FROM file_correlations
       WHERE project_id = ?
       AND cochange_count = 1
       AND updated_at < datetime('now', '-90 days')
       LIMIT 50`,
      [projectId],
    );

    for (const row of weak) {
      await db.run(
        `DELETE FROM file_correlations WHERE id = ?`,
        [row.id],
      );
      results.push({
        type: "correlation",
        id: row.id,
        reason: "Single co-change older than 90 days",
      });
    }
  } catch {
    // Best-effort — file_correlations might not have id or updated_at
  }

  return results;
}
