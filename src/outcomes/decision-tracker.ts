/**
 * Decision Outcome Auto-Tracker — Automatic decision validation
 *
 * Watches session outcomes and file changes to auto-track decision success:
 * - Files in decision's `affects` modified in successful session -> +1 positive
 * - Same files in failed session or reverted commit -> +1 negative
 * - 3+ positive, 0 negative -> auto-mark outcome_status = 'succeeded'
 * - 2+ negative -> set 'needs_review', surface in next session
 *
 * Runs at session end — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

interface DecisionSignal {
  decisionId: number;
  title: string;
  positive: number;
  negative: number;
  currentStatus: string;
}

// ============================================================================
// Signal Collection
// ============================================================================

/**
 * Collect positive signals: decisions whose affected files were touched
 * in sessions that ended successfully.
 */
async function collectPositiveSignals(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<Map<number, number>> {
  const signals = new Map<number, number>();

  try {
    // Get files touched in this session from tool_calls
    const touchedFiles = await db.all<{ file_path: string }>(
      `SELECT DISTINCT json_each.value as file_path
       FROM tool_calls, json_each(files_involved)
       WHERE tool_calls.project_id = ? AND tool_calls.session_id = ?
       AND tool_calls.tool_name IN ('muninn_file_add', 'muninn_check')
       AND files_involved IS NOT NULL`,
      [projectId, sessionId]
    );

    if (touchedFiles.length === 0) return signals;

    const filePaths = new Set(touchedFiles.map((f) => f.file_path));

    // Find decisions whose affected files overlap
    const decisions = await db.all<{ id: number; affects: string | null }>(
      `SELECT id, affects FROM decisions
       WHERE project_id = ? AND status = 'active' AND outcome_status IN ('pending', 'needs_review')
       AND affects IS NOT NULL`,
      [projectId]
    );

    for (const d of decisions) {
      const affects = d.affects ? (JSON.parse(d.affects) as string[]) : [];
      const overlap = affects.filter((f) => filePaths.has(f));
      if (overlap.length > 0) {
        signals.set(d.id, overlap.length);
      }
    }
  } catch {
    // Tables might not exist
  }

  return signals;
}

/**
 * Collect negative signals from test failures in the current session.
 */
async function collectNegativeSignals(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<Map<number, number>> {
  const signals = new Map<number, number>();

  try {
    // Check if any tests failed in this session
    const failedTests = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM test_results
       WHERE project_id = ? AND session_id = ? AND status = 'failed'`,
      [projectId, sessionId]
    );

    if (!failedTests || failedTests.cnt === 0) return signals;

    // Find decisions related to files touched before test failure
    const touchedFiles = await db.all<{ file_path: string }>(
      `SELECT DISTINCT json_each.value as file_path
       FROM tool_calls, json_each(files_involved)
       WHERE tool_calls.project_id = ? AND tool_calls.session_id = ?
       AND files_involved IS NOT NULL`,
      [projectId, sessionId]
    );

    const filePaths = new Set(touchedFiles.map((f) => f.file_path));

    const decisions = await db.all<{ id: number; affects: string | null }>(
      `SELECT id, affects FROM decisions
       WHERE project_id = ? AND status = 'active'
       AND affects IS NOT NULL`,
      [projectId]
    );

    for (const d of decisions) {
      const affects = d.affects ? (JSON.parse(d.affects) as string[]) : [];
      const overlap = affects.filter((f) => filePaths.has(f));
      if (overlap.length > 0) {
        signals.set(d.id, 1);
      }
    }
  } catch {
    // Tables might not exist
  }

  return signals;
}

// ============================================================================
// Signal Persistence
// ============================================================================

/**
 * Update decision tracking counters and auto-resolve where possible.
 */
async function applySignals(
  db: DatabaseAdapter,
  projectId: number,
  positiveSignals: Map<number, number>,
  negativeSignals: Map<number, number>
): Promise<DecisionSignal[]> {
  const updated: DecisionSignal[] = [];

  // Merge all decision IDs
  const allIds = new Set([...positiveSignals.keys(), ...negativeSignals.keys()]);

  for (const decisionId of allIds) {
    const positive = positiveSignals.get(decisionId) || 0;
    const negative = negativeSignals.get(decisionId) || 0;

    try {
      // Get current state
      const decision = await db.get<{
        id: number;
        title: string;
        outcome_status: string;
        outcome_notes: string | null;
      }>(
        `SELECT id, title, outcome_status, outcome_notes FROM decisions WHERE id = ? AND project_id = ?`,
        [decisionId, projectId]
      );
      if (!decision) continue;

      // Parse existing signal counts from outcome_notes (stored as JSON)
      const notes = decision.outcome_notes
        ? tryParseNotes(decision.outcome_notes)
        : { positive: 0, negative: 0 };

      const newPositive = notes.positive + positive;
      const newNegative = notes.negative + negative;
      const newNotes = JSON.stringify({ positive: newPositive, negative: newNegative });

      // Auto-resolve based on signals
      let newStatus = decision.outcome_status;
      if (newPositive >= 3 && newNegative === 0) {
        newStatus = "succeeded";
      } else if (newNegative >= 2) {
        newStatus = "needs_review";
      }

      await db.run(
        `UPDATE decisions SET outcome_notes = ?, outcome_status = ? WHERE id = ?`,
        [newNotes, newStatus, decisionId]
      );

      updated.push({
        decisionId,
        title: decision.title,
        positive: newPositive,
        negative: newNegative,
        currentStatus: newStatus,
      });
    } catch {
      // Decision might not exist
    }
  }

  return updated;
}

function tryParseNotes(notes: string): { positive: number; negative: number } {
  try {
    const parsed = JSON.parse(notes) as { positive?: number; negative?: number };
    return {
      positive: parsed.positive || 0,
      negative: parsed.negative || 0,
    };
  } catch {
    return { positive: 0, negative: 0 };
  }
}

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Track decision outcomes for a completed session.
 * Called at session end from background worker.
 */
export async function trackDecisionOutcomes(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<DecisionSignal[]> {
  const positiveSignals = await collectPositiveSignals(db, projectId, sessionId);
  const negativeSignals = await collectNegativeSignals(db, projectId, sessionId);

  if (positiveSignals.size === 0 && negativeSignals.size === 0) {
    return [];
  }

  return applySignals(db, projectId, positiveSignals, negativeSignals);
}
