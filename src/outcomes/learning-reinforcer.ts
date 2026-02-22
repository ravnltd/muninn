/**
 * Learning Reinforcer — Bayesian confidence updates
 *
 * At session end, correlates injected learnings with session outcomes.
 * Confidence updates use a stabilizing delta: 1/sqrt(times_applied+1)
 * so early applications cause large swings while established learnings
 * are resistant to change.
 *
 * Runs as a background worker job after process_context_feedback.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

interface InjectedLearning {
  learningId: number;
  relevanceSignal: string | null;
  wasUsed: number;
}

interface LearningState {
  id: number;
  confidence: number;
  timesApplied: number;
  autoReinforcementCount: number;
}

interface ReinforcementResult {
  learningId: number;
  oldConfidence: number;
  newConfidence: number;
  delta: number;
  reason: string;
}

// ============================================================================
// Constants
// ============================================================================

const POSITIVE_BASE_DELTA = 0.3;
const NEGATIVE_BASE_DELTA = -0.4;
const DECAY_BASE_DELTA = -0.1;
const MIN_CONFIDENCE = 0.5;
const MAX_CONFIDENCE = 10.0;
const DECAY_THRESHOLD_DAYS = 30;

// ============================================================================
// Core Algorithm
// ============================================================================

/**
 * Compute the stabilizing factor for a learning.
 * As times_applied grows, updates get smaller.
 */
function stabilizingFactor(timesApplied: number): number {
  return 1 / Math.sqrt(timesApplied + 1);
}

/**
 * Compute confidence delta based on session outcome and usage signal.
 */
function computeDelta(
  signal: "positive" | "negative" | "neutral",
  timesApplied: number
): number {
  const factor = stabilizingFactor(timesApplied);

  switch (signal) {
    case "positive":
      return POSITIVE_BASE_DELTA * factor;
    case "negative":
      return NEGATIVE_BASE_DELTA * factor;
    case "neutral":
      return 0;
  }
}

/**
 * Clamp confidence to valid range.
 */
function clampConfidence(value: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, value));
}

/**
 * Determine the reinforcement signal from session data.
 * - If learning was injected and session succeeded -> positive
 * - If learning was injected and session failed -> negative
 * - If learning was injected with explicit relevance_signal -> use that
 */
function determineSignal(
  injection: InjectedLearning,
  sessionSuccess: number | null
): "positive" | "negative" | "neutral" {
  // Explicit signal from context_injections.relevance_signal takes priority
  if (injection.relevanceSignal === "positive") return "positive";
  if (injection.relevanceSignal === "negative") return "negative";
  if (injection.relevanceSignal === "neutral") return "neutral";

  // Fall back to session outcome correlation
  if (sessionSuccess === null) return "neutral";
  if (injection.wasUsed === 0) return "neutral";

  // success=2 -> positive, success=0 -> negative, success=1 -> neutral
  if (sessionSuccess >= 2) return "positive";
  if (sessionSuccess === 0) return "negative";
  return "neutral";
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Reinforce learnings based on session outcomes.
 * Called from background worker after context feedback processing.
 */
export async function reinforceLearnings(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<ReinforcementResult[]> {
  const results: ReinforcementResult[] = [];

  try {
    // Get session outcome
    const session = await db.get<{ success: number | null }>(
      `SELECT
         CASE outcome
           WHEN 'success' THEN 2
           WHEN 'partial' THEN 1
           WHEN 'failed' THEN 0
           ELSE NULL
         END as success
       FROM sessions WHERE id = ?`,
      [sessionId]
    );

    // Get all learnings that were injected in this session
    const injections = await db.all<{
      source_id: number;
      relevance_signal: string | null;
      was_used: number;
    }>(
      `SELECT source_id, relevance_signal, was_used
       FROM context_injections
       WHERE project_id = ? AND session_id = ?
       AND context_type = 'learning' AND source_id IS NOT NULL`,
      [projectId, sessionId]
    );

    if (injections.length === 0) return results;

    // Get unique learning IDs
    const learningIds = [...new Set(injections.map((i) => i.source_id))];

    for (const learningId of learningIds) {
      const learning = await db.get<{
        id: number;
        confidence: number;
        times_applied: number;
        auto_reinforcement_count: number;
      }>(
        `SELECT id, confidence, times_applied, auto_reinforcement_count
         FROM learnings WHERE id = ?`,
        [learningId]
      );

      if (!learning) continue;

      // Find the injection record for this learning
      const injection = injections.find((i) => i.source_id === learningId);
      if (!injection) continue;

      const injectedLearning: InjectedLearning = {
        learningId,
        relevanceSignal: injection.relevance_signal,
        wasUsed: injection.was_used,
      };

      const state: LearningState = {
        id: learning.id,
        confidence: learning.confidence,
        timesApplied: learning.times_applied ?? 0,
        autoReinforcementCount: learning.auto_reinforcement_count ?? 0,
      };

      const signal = determineSignal(injectedLearning, session?.success ?? null);
      if (signal === "neutral") continue;

      const delta = computeDelta(signal, state.timesApplied);
      if (delta === 0) continue;

      const newConfidence = clampConfidence(state.confidence + delta);
      const reason = signal === "positive"
        ? "Session succeeded with this learning applied"
        : "Session failed with this learning applied";

      // Update the learning
      await db.run(
        `UPDATE learnings SET
           confidence = ?,
           auto_reinforcement_count = auto_reinforcement_count + 1,
           last_reinforced_at = datetime('now')
         WHERE id = ?`,
        [newConfidence, learningId]
      );

      results.push({
        learningId,
        oldConfidence: state.confidence,
        newConfidence,
        delta,
        reason,
      });
    }

    // Apply decay to learnings not used in a long time
    const decayed = await applyDecay(db, projectId);
    results.push(...decayed);
  } catch {
    // Best-effort — tables might not exist
  }

  return results;
}

// ============================================================================
// Decay
// ============================================================================

/**
 * Apply gradual confidence decay to learnings not reinforced recently.
 * Prevents stale learnings from maintaining artificially high confidence.
 */
async function applyDecay(
  db: DatabaseAdapter,
  projectId: number
): Promise<ReinforcementResult[]> {
  const results: ReinforcementResult[] = [];

  try {
    const staleLearnings = await db.all<{
      id: number;
      confidence: number;
      times_applied: number;
    }>(
      `SELECT id, confidence, times_applied FROM learnings
       WHERE (project_id = ? OR project_id IS NULL)
       AND archived_at IS NULL
       AND confidence > ?
       AND (last_reinforced_at IS NULL
            OR last_reinforced_at < datetime('now', ?))
       LIMIT 20`,
      [projectId, MIN_CONFIDENCE, `-${DECAY_THRESHOLD_DAYS} days`]
    );

    for (const learning of staleLearnings) {
      const factor = stabilizingFactor(learning.times_applied ?? 0);
      const delta = DECAY_BASE_DELTA * factor;
      const newConfidence = clampConfidence(learning.confidence + delta);

      if (newConfidence === learning.confidence) continue;

      await db.run(
        `UPDATE learnings SET
           confidence = ?,
           auto_reinforcement_count = auto_reinforcement_count + 1,
           last_reinforced_at = datetime('now')
         WHERE id = ?`,
        [newConfidence, learning.id]
      );

      results.push({
        learningId: learning.id,
        oldConfidence: learning.confidence,
        newConfidence,
        delta,
        reason: "Confidence decay from inactivity",
      });
    }
  } catch {
    // Best-effort
  }

  return results;
}
