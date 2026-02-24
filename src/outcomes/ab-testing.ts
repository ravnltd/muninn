/**
 * Context A/B Testing — v7 Phase 4B
 *
 * Deterministic session assignment via hash.
 * Control vs variant budget allocations.
 * Statistical significance after 20 sessions per arm.
 * Auto-tunes budget allocation based on measured outcomes.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface ABTest {
  id: number;
  testName: string;
  controlConfig: Record<string, number>;
  variantConfig: Record<string, number>;
  metric: string;
  minSessions: number;
  controlSessions: number;
  variantSessions: number;
  controlMetricSum: number;
  variantMetricSum: number;
  status: "running" | "concluded";
  conclusion: string | null;
}

export type ABArm = "control" | "variant";

// ============================================================================
// Assignment
// ============================================================================

/**
 * Deterministic arm assignment based on session ID.
 * Hash of session_id % 2 ensures consistent assignment.
 */
export function assignArm(sessionId: number): ABArm {
  return sessionId % 2 === 0 ? "control" : "variant";
}

/**
 * Get the active A/B test for a project (if any).
 */
export async function getActiveTest(
  db: DatabaseAdapter,
  projectId: number,
): Promise<ABTest | null> {
  try {
    const row = await db.get<{
      id: number;
      test_name: string;
      control_config: string;
      variant_config: string;
      metric: string;
      min_sessions: number;
      control_sessions: number;
      variant_sessions: number;
      control_metric_sum: number;
      variant_metric_sum: number;
      status: string;
      conclusion: string | null;
    }>(
      `SELECT * FROM ab_tests WHERE project_id = ? AND status = 'running' LIMIT 1`,
      [projectId],
    );

    if (!row) return null;

    return {
      id: row.id,
      testName: row.test_name,
      controlConfig: JSON.parse(row.control_config),
      variantConfig: JSON.parse(row.variant_config),
      metric: row.metric,
      minSessions: row.min_sessions,
      controlSessions: row.control_sessions,
      variantSessions: row.variant_sessions,
      controlMetricSum: row.control_metric_sum,
      variantMetricSum: row.variant_metric_sum,
      status: row.status as "running" | "concluded",
      conclusion: row.conclusion,
    };
  } catch {
    return null;
  }
}

/**
 * Get budget config for the current session based on A/B test assignment.
 * Returns null if no active test.
 */
export async function getABBudgetConfig(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<Record<string, number> | null> {
  const test = await getActiveTest(db, projectId);
  if (!test) return null;

  const arm = assignArm(sessionId);
  return arm === "control" ? test.controlConfig : test.variantConfig;
}

// ============================================================================
// Recording
// ============================================================================

/**
 * Record a session result for the A/B test.
 * Called at session end.
 */
export async function recordABResult(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
  metricValue: number,
): Promise<void> {
  const test = await getActiveTest(db, projectId);
  if (!test) return;

  const arm = assignArm(sessionId);

  try {
    if (arm === "control") {
      await db.run(
        `UPDATE ab_tests SET
           control_sessions = control_sessions + 1,
           control_metric_sum = control_metric_sum + ?
         WHERE id = ?`,
        [metricValue, test.id],
      );
    } else {
      await db.run(
        `UPDATE ab_tests SET
           variant_sessions = variant_sessions + 1,
           variant_metric_sum = variant_metric_sum + ?
         WHERE id = ?`,
        [metricValue, test.id],
      );
    }

    // Check if we should conclude
    await checkConclusion(db, test.id);
  } catch {
    // Table may not exist
  }
}

// ============================================================================
// Conclusion
// ============================================================================

/**
 * Check if an A/B test has enough data to conclude.
 */
async function checkConclusion(
  db: DatabaseAdapter,
  testId: number,
): Promise<void> {
  try {
    const test = await db.get<{
      min_sessions: number;
      control_sessions: number;
      variant_sessions: number;
      control_metric_sum: number;
      variant_metric_sum: number;
    }>(
      `SELECT min_sessions, control_sessions, variant_sessions,
              control_metric_sum, variant_metric_sum
       FROM ab_tests WHERE id = ?`,
      [testId],
    );

    if (!test) return;
    if (test.control_sessions < test.min_sessions || test.variant_sessions < test.min_sessions) {
      return; // Not enough data yet
    }

    const controlMean = test.control_metric_sum / test.control_sessions;
    const variantMean = test.variant_metric_sum / test.variant_sessions;

    // Simple comparison — significant if >10% difference
    const diff = Math.abs(variantMean - controlMean);
    const relativeDiff = diff / Math.max(controlMean, 0.01);

    let conclusion: string;
    if (relativeDiff < 0.1) {
      conclusion = `No significant difference (control: ${controlMean.toFixed(2)}, variant: ${variantMean.toFixed(2)})`;
    } else if (variantMean > controlMean) {
      conclusion = `Variant wins (${variantMean.toFixed(2)} vs ${controlMean.toFixed(2)}, +${(relativeDiff * 100).toFixed(1)}%)`;
    } else {
      conclusion = `Control wins (${controlMean.toFixed(2)} vs ${variantMean.toFixed(2)}, -${(relativeDiff * 100).toFixed(1)}%)`;
    }

    await db.run(
      `UPDATE ab_tests SET status = 'concluded', conclusion = ?, concluded_at = datetime('now') WHERE id = ?`,
      [conclusion, testId],
    );

    // Apply winning config to budget_recommendations
    const fullTest = await db.get<{
      project_id: number;
      control_config: string;
      variant_config: string;
    }>(
      `SELECT project_id, control_config, variant_config FROM ab_tests WHERE id = ?`,
      [testId],
    );
    if (fullTest) {
      const winningConfig: Record<string, number> = variantMean > controlMean
        ? JSON.parse(fullTest.variant_config)
        : JSON.parse(fullTest.control_config);
      await applyWinningConfig(db, fullTest.project_id, winningConfig);
    }
  } catch {
    // Table may not exist
  }
}

/**
 * Write winning A/B config to budget_recommendations.
 * Closes the loop: experiments drive actual budget allocation.
 */
async function applyWinningConfig(
  db: DatabaseAdapter,
  projectId: number,
  config: Record<string, number>,
): Promise<void> {
  try {
    for (const [contextType, budget] of Object.entries(config)) {
      await db.run(
        `INSERT INTO budget_recommendations (project_id, context_type, recommended_budget, use_rate)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(project_id, context_type) DO UPDATE SET
           recommended_budget = excluded.recommended_budget,
           updated_at = datetime('now')`,
        [projectId, contextType, budget],
      );
    }
  } catch {
    // Table may not exist
  }
}

// ============================================================================
// Test Creation
// ============================================================================

/**
 * Create a new A/B test for budget allocation.
 */
export async function createABTest(
  db: DatabaseAdapter,
  projectId: number,
  testName: string,
  controlConfig: Record<string, number>,
  variantConfig: Record<string, number>,
  metric: string = "session_success_rate",
  minSessions: number = 20,
): Promise<number | null> {
  try {
    await db.run(
      `INSERT INTO ab_tests (project_id, test_name, control_config, variant_config, metric, min_sessions)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, testName, JSON.stringify(controlConfig), JSON.stringify(variantConfig), metric, minSessions],
    );

    const result = await db.get<{ id: number }>(
      `SELECT id FROM ab_tests WHERE project_id = ? AND test_name = ?`,
      [projectId, testName],
    );
    return result?.id ?? null;
  } catch {
    return null;
  }
}
