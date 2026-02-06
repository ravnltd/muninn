/**
 * Cross-Project Pattern Detector — Find common patterns across projects
 *
 * Analyzes learnings, decisions, and error patterns to find:
 * - Common error patterns across projects
 * - Common architectural decisions
 * - Divergences between projects
 *
 * Works with local project data. Cloud aggregation layer queries across tenants.
 * Runs in background worker — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface CrossProjectPattern {
  type: "common_error" | "common_decision" | "divergence";
  title: string;
  description: string;
  evidence: string[];
  frequency: number;
}

// ============================================================================
// Analysis
// ============================================================================

/**
 * Detect common error patterns within a project that could apply elsewhere.
 * Finds errors that recur frequently and have known fixes.
 */
export async function detectCommonErrors(
  db: DatabaseAdapter,
  projectId: number
): Promise<CrossProjectPattern[]> {
  const patterns: CrossProjectPattern[] = [];

  try {
    const errors = await db.all<{
      error_type: string;
      error_signature: string;
      fix_description: string;
      times_seen: number;
      times_fixed: number;
    }>(
      `SELECT error_type, error_signature, fix_description, times_seen, times_fixed
       FROM error_fix_pairs
       WHERE project_id = ? AND times_fixed >= 2 AND confidence >= 0.6
       ORDER BY times_seen DESC
       LIMIT 10`,
      [projectId]
    );

    for (const error of errors) {
      patterns.push({
        type: "common_error",
        title: `${error.error_type}: ${error.error_signature.slice(0, 60)}`,
        description: `Fixed ${error.times_fixed} times. Fix: ${error.fix_description}`,
        evidence: [`Seen ${error.times_seen} times`, `Fixed ${error.times_fixed} times`],
        frequency: error.times_seen,
      });
    }
  } catch {
    // Tables might not exist
  }

  return patterns;
}

/**
 * Detect common architectural decisions that could be shared.
 * Finds decisions with high success rates.
 */
export async function detectCommonDecisions(
  db: DatabaseAdapter,
  projectId: number
): Promise<CrossProjectPattern[]> {
  const patterns: CrossProjectPattern[] = [];

  try {
    const decisions = await db.all<{
      title: string;
      decision: string;
      reasoning: string;
      outcome_status: string;
    }>(
      `SELECT title, decision, reasoning, outcome_status
       FROM decisions
       WHERE project_id = ? AND status = 'active' AND outcome_status = 'succeeded'
       ORDER BY decided_at DESC
       LIMIT 10`,
      [projectId]
    );

    for (const decision of decisions) {
      patterns.push({
        type: "common_decision",
        title: decision.title,
        description: `${decision.decision.slice(0, 150)}. Reasoning: ${decision.reasoning.slice(0, 100)}`,
        evidence: [`Outcome: ${decision.outcome_status}`],
        frequency: 1,
      });
    }
  } catch {
    // Tables might not exist
  }

  return patterns;
}

/**
 * Detect potential divergences — decisions that conflicted or were revised.
 */
export async function detectDivergences(
  db: DatabaseAdapter,
  projectId: number
): Promise<CrossProjectPattern[]> {
  const patterns: CrossProjectPattern[] = [];

  try {
    // Find failed or revised decisions
    const divergent = await db.all<{
      title: string;
      decision: string;
      outcome_status: string;
      outcome_notes: string | null;
    }>(
      `SELECT title, decision, outcome_status, outcome_notes
       FROM decisions
       WHERE project_id = ? AND outcome_status IN ('failed', 'revised', 'needs_review')
       ORDER BY outcome_at DESC
       LIMIT 10`,
      [projectId]
    );

    for (const d of divergent) {
      patterns.push({
        type: "divergence",
        title: `Divergence: ${d.title}`,
        description: `Decision ${d.outcome_status}: ${d.decision.slice(0, 150)}`,
        evidence: [
          `Status: ${d.outcome_status}`,
          d.outcome_notes ? `Notes: ${d.outcome_notes.slice(0, 100)}` : "No notes",
        ],
        frequency: 1,
      });
    }
  } catch {
    // Tables might not exist
  }

  return patterns;
}

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Run all cross-project pattern detectors.
 */
export async function detectAllPatterns(
  db: DatabaseAdapter,
  projectId: number
): Promise<CrossProjectPattern[]> {
  const [errors, decisions, divergences] = await Promise.all([
    detectCommonErrors(db, projectId),
    detectCommonDecisions(db, projectId),
    detectDivergences(db, projectId),
  ]);

  return [...errors, ...decisions, ...divergences];
}

/**
 * Persist cross-project patterns as team learnings.
 */
export async function persistCrossProjectInsights(
  db: DatabaseAdapter,
  projectId: number,
  patterns: CrossProjectPattern[]
): Promise<number> {
  let persisted = 0;

  for (const pattern of patterns) {
    if (pattern.type === "common_error" && pattern.frequency >= 3) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO team_learnings (project_id, title, content, category, confidence, is_global)
           VALUES (?, ?, ?, 'gotcha', ?, 1)`,
          [projectId, pattern.title.slice(0, 200), pattern.description, Math.min(0.9, 0.5 + pattern.frequency * 0.05)]
        );
        persisted++;
      } catch {
        // Might already exist
      }
    }
  }

  return persisted;
}
