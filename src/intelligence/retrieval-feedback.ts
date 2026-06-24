// @muninn — context in .muninn/context/
/**
 * Retrieval Quality Feedback Loop
 *
 * Analyzes tool_calls to determine which recalled items were actually
 * useful (i.e., the next tool call after a recall acted on a recalled file).
 * Computes per-item usefulness scores to boost future retrieval ranking.
 */

import type { DatabaseAdapter } from "../database/adapter.js";

// ============================================================================
// Types
// ============================================================================

interface RecallToolCall {
  id: number;
  recall_result_ids: string;
  files_involved: string | null;
}

interface NextToolCall {
  files_involved: string | null;
}

interface FeedbackScore {
  key: string;
  score: number;
  hits: number;
  total: number;
}

// ============================================================================
// Feedback Computation
// ============================================================================

/**
 * Compute retrieval feedback by checking if recalled items were acted upon.
 * Looks at recent recall tool_calls and the next tool call after each.
 */
export async function computeRetrievalFeedback(
  db: DatabaseAdapter,
  projectId: number,
): Promise<FeedbackScore[]> {
  // Get recent recall calls with result IDs (last 50)
  let recallCalls: RecallToolCall[];
  try {
    recallCalls = await db.all<RecallToolCall>(
      `SELECT id, recall_result_ids, files_involved
       FROM tool_calls
       WHERE project_id = ? AND tool_name = 'recall'
       AND recall_result_ids IS NOT NULL
       ORDER BY id DESC LIMIT 50`,
      [projectId],
    );
  } catch {
    return []; // tool_calls table might not exist
  }

  if (recallCalls.length === 0) return [];

  const scores = new Map<string, { hits: number; total: number }>();

  for (const call of recallCalls) {
    const resultIds = parseResultIds(call.recall_result_ids);
    if (resultIds.length === 0) continue;

    // Get the next tool call after this recall
    let next: NextToolCall | null = null;
    try {
      next = await db.get<NextToolCall>(
        `SELECT files_involved FROM tool_calls
         WHERE project_id = ? AND id > ? AND tool_name != 'recall'
         ORDER BY id ASC LIMIT 1`,
        [projectId, call.id],
      );
    } catch {
      continue;
    }

    const nextFiles = parseFilesInvolved(next?.files_involved);

    // Score each recalled item based on whether it was used
    for (const rid of resultIds) {
      const entry = scores.get(rid) ?? { hits: 0, total: 0 };
      entry.total++;

      if (wasItemUsed(rid, nextFiles)) {
        entry.hits++;
      }

      scores.set(rid, entry);
    }
  }

  return Array.from(scores.entries()).map(([key, { hits, total }]) => ({
    key,
    score: total > 0 ? hits / total : 0,
    hits,
    total,
  }));
}

/**
 * Get retrieval boosts as a map of item key -> boost score.
 * Items frequently acted upon get positive boosts.
 * Items never acted upon get negative boosts.
 */
export async function getRetrievalBoosts(
  db: DatabaseAdapter,
  projectId: number,
): Promise<Map<string, number>> {
  const feedback = await computeRetrievalFeedback(db, projectId);
  const boosts = new Map<string, number>();

  for (const item of feedback) {
    if (item.total < 2) continue; // Need enough data
    // Score range: -0.1 (never used) to +0.2 (always used)
    const boost = (item.score - 0.3) * 0.3;
    boosts.set(item.key, Math.max(-0.1, Math.min(0.2, boost)));
  }

  return boosts;
}

// ============================================================================
// Helpers
// ============================================================================

function parseResultIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function parseFilesInvolved(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Check if a recalled item was used in the next tool call */
function wasItemUsed(resultId: string, nextFiles: string[]): boolean {
  if (nextFiles.length === 0) return false;

  // file:path/to/file -> check if next tool touched that file
  if (resultId.startsWith("file:")) {
    const filePath = resultId.slice(5);
    return nextFiles.some((f) => f === filePath || f.endsWith(filePath));
  }

  return false;
}
