/**
 * Workflow Predictor — v7 Phase 3A
 *
 * Trigram model: predicts next tool call from last 3 tool names.
 * Pre-computes context for predicted tool+files.
 *
 * P(next_action | last_3_actions) with Laplace smoothing.
 * Confidence > 0.7 triggers pre-computation.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface WorkflowPrediction {
  predictedTool: string;
  predictedArgs: Record<string, unknown> | null;
  confidence: number;
  triggerSequence: string;
}

interface TrigramCount {
  trigger_sequence: string;
  predicted_tool: string;
  times_correct: number;
  times_total: number;
}

// ============================================================================
// In-Memory Prediction Cache
// ============================================================================

const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  prediction: WorkflowPrediction;
  expiresAt: number;
}

const predictionCache = new Map<string, CacheEntry>();

/**
 * Get a cached prediction if available and not expired.
 */
export function getCachedPrediction(trigram: string): WorkflowPrediction | null {
  const entry = predictionCache.get(trigram);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.prediction;
  }
  if (entry) {
    predictionCache.delete(trigram);
  }
  return null;
}

/**
 * Cache a prediction with TTL.
 */
function cachePrediction(trigram: string, prediction: WorkflowPrediction): void {
  // Evict old entries if cache is too large
  if (predictionCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of predictionCache) {
      if (entry.expiresAt < now) predictionCache.delete(key);
    }
  }

  predictionCache.set(trigram, {
    prediction,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ============================================================================
// Prediction
// ============================================================================

/**
 * Predict the next tool call given the last 3 tool names.
 * Uses the trigram model built by the background job.
 */
export async function predictNextAction(
  db: DatabaseAdapter,
  projectId: number,
  recentTools: string[],
): Promise<WorkflowPrediction | null> {
  if (recentTools.length < 3) return null;

  const trigram = recentTools.slice(-3).join(",");

  // Check cache first (~0ms)
  const cached = getCachedPrediction(trigram);
  if (cached) return cached;

  // Look up trigram in database (~2ms)
  try {
    const match = await db.get<TrigramCount>(
      `SELECT trigger_sequence, predicted_tool, times_correct, times_total
       FROM workflow_predictions
       WHERE project_id = ? AND trigger_sequence = ?
       ORDER BY confidence DESC LIMIT 1`,
      [projectId, trigram],
    );

    if (!match || match.times_total < 3) return null;

    // Laplace-smoothed confidence
    const confidence = (match.times_correct + 1) / (match.times_total + 2);

    if (confidence < 0.5) return null;

    const prediction: WorkflowPrediction = {
      predictedTool: match.predicted_tool,
      predictedArgs: null,
      confidence,
      triggerSequence: trigram,
    };

    cachePrediction(trigram, prediction);
    return prediction;
  } catch {
    return null;
  }
}

// ============================================================================
// Model Building (Background Job)
// ============================================================================

/**
 * Build trigram frequency model from tool_calls history.
 * Runs every 10 sessions.
 */
export async function buildWorkflowModel(
  db: DatabaseAdapter,
  projectId: number,
): Promise<{ trigrams: number; updated: number }> {
  let updated = 0;

  // Get recent tool calls grouped by session
  const sessions = await db.all<{ session_id: number }>(
    `SELECT DISTINCT session_id FROM tool_calls
     WHERE project_id = ? AND session_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 50`,
    [projectId],
  );

  // Count trigram -> next_tool frequencies
  const trigramCounts = new Map<string, Map<string, { correct: number; total: number }>>();

  for (const { session_id } of sessions) {
    const calls = await db.all<{ tool_name: string }>(
      `SELECT tool_name FROM tool_calls
       WHERE session_id = ? AND project_id = ?
       ORDER BY created_at ASC`,
      [session_id, projectId],
    );

    const tools = calls.map((c) => c.tool_name);
    for (let i = 3; i < tools.length; i++) {
      const trigram = tools.slice(i - 3, i).join(",");
      const nextTool = tools[i];

      if (!trigramCounts.has(trigram)) {
        trigramCounts.set(trigram, new Map());
      }
      const toolMap = trigramCounts.get(trigram)!;
      const existing = toolMap.get(nextTool) ?? { correct: 0, total: 0 };
      existing.correct++;
      existing.total++;
      toolMap.set(nextTool, existing);

      // Also increment total for all predictions of this trigram
      for (const [, counts] of toolMap) {
        if (counts !== existing) {
          counts.total++;
        }
      }
    }
  }

  // Persist trigrams to database
  for (const [trigram, toolMap] of trigramCounts) {
    for (const [predictedTool, counts] of toolMap) {
      if (counts.correct < 2) continue; // Skip rare sequences

      const confidence = (counts.correct + 1) / (counts.total + 2);

      try {
        await db.run(
          `INSERT INTO workflow_predictions
           (project_id, trigger_sequence, predicted_tool, times_correct, times_total, confidence)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, trigger_sequence, predicted_tool) DO UPDATE SET
             times_correct = excluded.times_correct,
             times_total = excluded.times_total,
             confidence = excluded.confidence,
             updated_at = datetime('now')`,
          [projectId, trigram, predictedTool, counts.correct, counts.total, confidence],
        );
        updated++;
      } catch {
        // Table may not exist
      }
    }
  }

  return { trigrams: trigramCounts.size, updated };
}
