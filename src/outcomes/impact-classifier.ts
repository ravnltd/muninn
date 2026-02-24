/**
 * Impact Classifier — v7 Phase 4A
 *
 * Classifies context impact at session end:
 * - "helped": Context referenced + tests pass
 * - "irrelevant": Context never referenced
 * - "harmful": Context referenced + tests fail
 * - "unknown": Insufficient data
 *
 * Feeds into learning reinforcer, budget manager, strategy catalog.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export type ImpactSignal = "helped" | "irrelevant" | "harmful" | "unknown";

export interface ImpactRecord {
  contextType: string;
  contentHash: string;
  signal: ImpactSignal;
  details: string;
}

// ============================================================================
// Main
// ============================================================================

/**
 * Classify impact of context injections for a session.
 * Runs at session end as a background job.
 */
export async function classifyImpact(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<ImpactRecord[]> {
  const records: ImpactRecord[] = [];

  // Get context injections for this session
  const injections = await getSessionInjections(db, projectId, sessionId);
  if (injections.length === 0) return records;

  // Get session outcome
  const session = await db.get<{ success: number | null }>(
    `SELECT success FROM sessions WHERE id = ?`,
    [sessionId],
  );
  const sessionSuccess = session?.success ?? null;

  // Get files touched in session
  const touchedFiles = await getSessionFiles(db, projectId, sessionId);

  // Classify each injection
  for (const injection of injections) {
    const signal = classifyInjection(injection, sessionSuccess, touchedFiles);
    const record: ImpactRecord = {
      contextType: injection.contextType,
      contentHash: injection.contentHash,
      signal,
      details: `session:${sessionId} success:${sessionSuccess} used:${injection.wasUsed}`,
    };
    records.push(record);

    // Persist
    try {
      await db.run(
        `INSERT INTO impact_tracking (project_id, session_id, context_type, content_hash, outcome_signal, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [projectId, sessionId, record.contextType, record.contentHash, record.signal, record.details],
      );
    } catch {
      // Table may not exist
    }
  }

  return records;
}

/**
 * Get impact statistics for a context type.
 * Used by the budget manager to adjust allocations.
 */
export async function getImpactStats(
  db: DatabaseAdapter,
  projectId: number,
): Promise<Record<string, { helped: number; irrelevant: number; harmful: number; total: number }>> {
  const stats: Record<string, { helped: number; irrelevant: number; harmful: number; total: number }> = {};

  try {
    const rows = await db.all<{
      context_type: string;
      outcome_signal: string;
      cnt: number;
    }>(
      `SELECT context_type, outcome_signal, COUNT(*) as cnt
       FROM impact_tracking
       WHERE project_id = ?
       AND created_at > datetime('now', '-30 days')
       GROUP BY context_type, outcome_signal`,
      [projectId],
    );

    for (const row of rows) {
      if (!stats[row.context_type]) {
        stats[row.context_type] = { helped: 0, irrelevant: 0, harmful: 0, total: 0 };
      }
      const s = stats[row.context_type];
      if (row.outcome_signal === "helped") s.helped += row.cnt;
      else if (row.outcome_signal === "irrelevant") s.irrelevant += row.cnt;
      else if (row.outcome_signal === "harmful") s.harmful += row.cnt;
      s.total += row.cnt;
    }
  } catch {
    // Table may not exist
  }

  return stats;
}

// ============================================================================
// Helpers
// ============================================================================

interface ContextInjection {
  id: number;
  contextType: string;
  contentHash: string;
  wasUsed: number;
  relevanceScore: number;
}

async function getSessionInjections(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<ContextInjection[]> {
  try {
    return await db.all<ContextInjection>(
      `SELECT id, context_type as contextType, content_hash as contentHash,
              was_used as wasUsed, relevance_score as relevanceScore
       FROM context_injections
       WHERE project_id = ? AND session_id = ?`,
      [projectId, sessionId],
    );
  } catch {
    return [];
  }
}

async function getSessionFiles(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<Set<string>> {
  const files = new Set<string>();
  try {
    const rows = await db.all<{ files_involved: string | null }>(
      `SELECT files_involved FROM tool_calls
       WHERE session_id = ? AND project_id = ? AND files_involved IS NOT NULL`,
      [sessionId, projectId],
    );
    for (const row of rows) {
      if (row.files_involved) {
        for (const f of row.files_involved.split(",")) {
          files.add(f.trim());
        }
      }
    }
  } catch {
    // Table may not exist
  }
  return files;
}

function classifyInjection(
  injection: ContextInjection,
  sessionSuccess: number | null,
  _touchedFiles: Set<string>,
): ImpactSignal {
  // If not referenced at all, it was irrelevant
  if (!injection.wasUsed) {
    return "irrelevant";
  }

  // If referenced and session succeeded
  if (sessionSuccess === 2) {
    return "helped";
  }

  // If referenced and session failed
  if (sessionSuccess === 0) {
    return "harmful";
  }

  // Partial success or unknown
  if (sessionSuccess === 1) {
    return injection.relevanceScore > 0.5 ? "helped" : "unknown";
  }

  return "unknown";
}
