/**
 * Confidence Calibrator — Learn what predictions are accurate
 *
 * Tracks prediction accuracy:
 * - muninn_predict/suggest files -> did the AI actually use them?
 * - Error-fix suggestions applied -> did the fix work?
 * - Aggregate per category -> adjust Token Budget Manager weights
 *
 * Stores feedback in retrieval_feedback table.
 * Runs at session end — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface CalibrationResult {
  contextType: string;
  suggested: number;
  used: number;
  accuracy: number;
}

// ============================================================================
// Feedback Collection
// ============================================================================

/**
 * Compare what was suggested vs what was actually used in a session.
 * Records feedback entries for each suggestion.
 */
export async function collectSessionFeedback(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<number> {
  let recorded = 0;

  try {
    // Get files suggested via predict/suggest tools
    const suggestions = await db.all<{
      tool_name: string;
      files_involved: string | null;
    }>(
      `SELECT tool_name, files_involved FROM tool_calls
       WHERE project_id = ? AND session_id = ?
       AND tool_name IN ('muninn_predict', 'muninn_suggest', 'muninn_enrich')
       AND files_involved IS NOT NULL`,
      [projectId, sessionId]
    );

    // Get files actually touched (via file_add, check, or edit tool calls)
    const touchedFiles = await db.all<{ file_path: string }>(
      `SELECT DISTINCT json_each.value as file_path
       FROM tool_calls, json_each(files_involved)
       WHERE tool_calls.project_id = ? AND tool_calls.session_id = ?
       AND tool_calls.tool_name IN ('muninn_file_add', 'muninn_check')
       AND files_involved IS NOT NULL`,
      [projectId, sessionId]
    );

    const touchedSet = new Set(touchedFiles.map((f) => f.file_path));

    // For each suggestion, check if the files were used
    for (const suggestion of suggestions) {
      const files = suggestion.files_involved
        ? (JSON.parse(suggestion.files_involved) as string[])
        : [];

      const contextType = suggestion.tool_name === "muninn_predict"
        ? "prediction"
        : suggestion.tool_name === "muninn_suggest"
          ? "suggestion"
          : "enrichment";

      for (const file of files) {
        const wasUsed = touchedSet.has(file) ? 1 : 0;

        await db.run(
          `INSERT INTO retrieval_feedback (project_id, session_id, context_type, item_path, was_suggested, was_used, relevance_score)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
          [projectId, sessionId, contextType, file, wasUsed, wasUsed ? 1.0 : 0.0]
        );
        recorded++;
      }
    }
  } catch {
    // Tables might not exist
  }

  return recorded;
}

// ============================================================================
// Accuracy Computation
// ============================================================================

/**
 * Compute accuracy per context type across recent sessions.
 */
export async function computeAccuracy(
  db: DatabaseAdapter,
  projectId: number,
  windowSessions: number = 20
): Promise<CalibrationResult[]> {
  try {
    const results = await db.all<{
      context_type: string;
      suggested: number;
      used: number;
    }>(
      `SELECT context_type,
              COUNT(*) as suggested,
              SUM(was_used) as used
       FROM retrieval_feedback
       WHERE project_id = ?
       AND session_id IN (
         SELECT id FROM sessions
         WHERE project_id = ?
         ORDER BY started_at DESC
         LIMIT ?
       )
       GROUP BY context_type`,
      [projectId, projectId, windowSessions]
    );

    return results.map((r) => ({
      contextType: r.context_type,
      suggested: r.suggested,
      used: r.used,
      accuracy: r.suggested > 0 ? r.used / r.suggested : 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Get accuracy-based weight adjustments for the budget manager.
 * Returns multipliers: high accuracy = 1.2x, low accuracy = 0.8x.
 */
export async function getWeightAdjustments(
  db: DatabaseAdapter,
  projectId: number
): Promise<Record<string, number>> {
  const accuracy = await computeAccuracy(db, projectId);
  const adjustments: Record<string, number> = {};

  for (const result of accuracy) {
    if (result.suggested < 5) continue; // Not enough data

    if (result.accuracy >= 0.7) {
      adjustments[result.contextType] = 1.2;
    } else if (result.accuracy >= 0.4) {
      adjustments[result.contextType] = 1.0;
    } else {
      adjustments[result.contextType] = 0.8;
    }
  }

  return adjustments;
}
