/**
 * Auto-Outcome Detection — v7 Phase 1B
 *
 * Infers session outcomes from observable signals when the agent
 * doesn't explicitly set a success level. Eliminates the need for
 * manual `session end --success N`.
 *
 * Signals and weights:
 *   Commits made:      +0.2  (from tool_calls git patterns)
 *   Tests passed:      +0.2  (from test_results table)
 *   Issues resolved:   +0.1  (from issues.resolved_at in session window)
 *   Error events:      -0.2  (from error_events count)
 *   Reverts detected:  -0.3  (from revert_events or commit message patterns)
 *   File modifications: +0.1  (from muninn_file_add tool calls)
 *
 * Score >= 0.7 = success (2), 0.4-0.7 = partial (1), < 0.4 = failed (0)
 * Explicit agent input overrides inference.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface OutcomeSignal {
  name: string;
  value: number;
  weight: number;
  details?: string;
}

export interface InferredOutcome {
  score: number;
  success: 0 | 1 | 2;
  signals: OutcomeSignal[];
  summary: string;
}

// ============================================================================
// Signal Weights
// ============================================================================

const SIGNAL_WEIGHTS = {
  commits: 0.2,
  testsPassed: 0.2,
  issuesResolved: 0.1,
  errorEvents: -0.2,
  revertsDetected: -0.3,
  fileModifications: 0.1,
} as const;

// ============================================================================
// Main
// ============================================================================

/**
 * Infer session outcome from observable signals.
 * Returns a score and mapped success level.
 */
export async function inferSessionOutcome(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<InferredOutcome> {
  const signals: OutcomeSignal[] = [];

  // Run all signal collectors in parallel
  const [commits, tests, issues, errors, reverts, fileMods] = await Promise.allSettled([
    collectCommitSignal(db, projectId, sessionId),
    collectTestSignal(db, projectId, sessionId),
    collectIssueSignal(db, projectId, sessionId),
    collectErrorSignal(db, projectId, sessionId),
    collectRevertSignal(db, projectId, sessionId),
    collectFileModSignal(db, projectId, sessionId),
  ]);

  // Aggregate successful signals
  for (const result of [commits, tests, issues, errors, reverts, fileMods]) {
    if (result.status === "fulfilled" && result.value) {
      signals.push(result.value);
    }
  }

  // Compute weighted score (base 0.5 — neutral start)
  let score = 0.5;
  for (const signal of signals) {
    score += signal.value * signal.weight;
  }

  // Clamp to [0, 1]
  score = Math.max(0, Math.min(1, score));

  // Map to success level
  const success: 0 | 1 | 2 = score >= 0.7 ? 2 : score >= 0.4 ? 1 : 0;

  // Build summary
  const positiveSignals = signals.filter((s) => s.value > 0);
  const negativeSignals = signals.filter((s) => s.value < 0);
  const parts: string[] = [];
  if (positiveSignals.length > 0) {
    parts.push(positiveSignals.map((s) => s.name).join(", "));
  }
  if (negativeSignals.length > 0) {
    parts.push(`issues: ${negativeSignals.map((s) => s.name).join(", ")}`);
  }
  const summary = parts.length > 0
    ? `Auto-inferred: ${["failed", "partial", "success"][success]} (${Math.round(score * 100)}%) — ${parts.join("; ")}`
    : `Auto-inferred: ${["failed", "partial", "success"][success]} (${Math.round(score * 100)}%)`;

  return { score, success, signals, summary };
}

// ============================================================================
// Signal Collectors
// ============================================================================

async function collectCommitSignal(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<OutcomeSignal | null> {
  try {
    // Look for git-related tool calls (commit patterns in passthrough)
    const gitCalls = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM tool_calls
       WHERE session_id = ? AND project_id = ?
       AND (tool_name = 'muninn' AND input_summary LIKE '%commit%'
            OR input_summary LIKE '%git%commit%')`,
      [sessionId, projectId],
    );

    // Also check git_commits table for commits during this session
    const commits = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM git_commits
       WHERE project_id = ? AND session_id = ?`,
      [projectId, sessionId],
    );

    const commitCount = (gitCalls?.cnt ?? 0) + (commits?.cnt ?? 0);
    if (commitCount > 0) {
      return {
        name: "commits",
        value: Math.min(commitCount, 3) / 3, // Normalize: 1-3 commits = 0.33-1.0
        weight: SIGNAL_WEIGHTS.commits,
        details: `${commitCount} commit(s)`,
      };
    }
  } catch {
    // Tables may not exist
  }
  return null;
}

async function collectTestSignal(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<OutcomeSignal | null> {
  try {
    const testResult = await db.get<{
      status: string;
      passed: number;
      failed: number;
    }>(
      `SELECT status, passed, failed FROM test_results
       WHERE project_id = ? AND session_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, sessionId],
    );

    if (testResult) {
      if (testResult.status === "passed" || (testResult.passed > 0 && testResult.failed === 0)) {
        return {
          name: "tests passed",
          value: 1,
          weight: SIGNAL_WEIGHTS.testsPassed,
          details: `${testResult.passed} passed`,
        };
      }
      if (testResult.failed > 0) {
        const failRate = testResult.failed / (testResult.passed + testResult.failed);
        return {
          name: "tests failed",
          value: -failRate,
          weight: Math.abs(SIGNAL_WEIGHTS.testsPassed),
          details: `${testResult.failed} failed, ${testResult.passed} passed`,
        };
      }
    }
  } catch {
    // Table may not exist
  }
  return null;
}

async function collectIssueSignal(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<OutcomeSignal | null> {
  try {
    // Check for issues resolved during this session's time window
    const session = await db.get<{ started_at: string }>(
      `SELECT started_at FROM sessions WHERE id = ?`,
      [sessionId],
    );
    if (!session) return null;

    const resolved = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM issues
       WHERE project_id = ? AND status = 'resolved'
       AND resolved_at >= ?`,
      [projectId, session.started_at],
    );

    if (resolved && resolved.cnt > 0) {
      return {
        name: "issues resolved",
        value: Math.min(resolved.cnt, 3) / 3,
        weight: SIGNAL_WEIGHTS.issuesResolved,
        details: `${resolved.cnt} issue(s) resolved`,
      };
    }
  } catch {
    // Table may not exist
  }
  return null;
}

async function collectErrorSignal(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<OutcomeSignal | null> {
  try {
    const errors = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM error_events
       WHERE project_id = ? AND session_id = ?`,
      [projectId, sessionId],
    );

    if (errors && errors.cnt > 0) {
      // More errors = worse signal (1-3 moderate, 4+ bad)
      const severity = Math.min(errors.cnt, 5) / 5;
      return {
        name: "errors",
        value: -severity,
        weight: Math.abs(SIGNAL_WEIGHTS.errorEvents),
        details: `${errors.cnt} error(s) detected`,
      };
    }
  } catch {
    // Table may not exist
  }
  return null;
}

async function collectRevertSignal(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<OutcomeSignal | null> {
  try {
    // Check revert_events for this session
    const reverts = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM revert_events
       WHERE project_id = ? AND original_session_id = ?`,
      [projectId, sessionId],
    );

    if (reverts && reverts.cnt > 0) {
      return {
        name: "reverts",
        value: -1,
        weight: Math.abs(SIGNAL_WEIGHTS.revertsDetected),
        details: `${reverts.cnt} revert(s)`,
      };
    }
  } catch {
    // Table may not exist
  }
  return null;
}

async function collectFileModSignal(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<OutcomeSignal | null> {
  try {
    const fileMods = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM tool_calls
       WHERE session_id = ? AND project_id = ?
       AND tool_name = 'muninn_file_add'`,
      [sessionId, projectId],
    );

    if (fileMods && fileMods.cnt > 0) {
      return {
        name: "file updates",
        value: Math.min(fileMods.cnt, 5) / 5,
        weight: SIGNAL_WEIGHTS.fileModifications,
        details: `${fileMods.cnt} file(s) updated`,
      };
    }
  } catch {
    // Table may not exist
  }
  return null;
}
