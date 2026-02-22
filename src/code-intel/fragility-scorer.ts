/**
 * Composite Fragility Scorer
 *
 * Multi-signal weighted scorer combining 7 factors for a 1-10 fragility score.
 * Replaces the simple dependent-count heuristic with a nuanced risk assessment.
 *
 * Signals and weights:
 *   1. Dependent count (0.25) — how many files import this
 *   2. Test coverage inverse (0.20) — files with no tests are more fragile
 *   3. Change velocity (0.15) — frequently changed files are riskier
 *   4. Error history (0.15) — files with past errors are fragile
 *   5. Export surface (0.10) — many exports = larger API surface
 *   6. Complexity proxy (0.10) — line count and symbol density
 *   7. Manual override (0.05) — user-set fragility as a bias
 *
 * Runs in background worker after call graph + test map builds.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface FragilitySignals {
  dependentCount: number;
  dependentScore: number;
  testCoverage: number;
  testScore: number;
  changeVelocity: number;
  velocityScore: number;
  errorCount: number;
  errorScore: number;
  exportCount: number;
  exportScore: number;
  complexity: number;
  complexityScore: number;
  manualOverride: number | null;
  overrideScore: number;
}

export interface FragilityResult {
  filePath: string;
  score: number;
  signals: FragilitySignals;
  explanation: string;
}

// ============================================================================
// Constants
// ============================================================================

const WEIGHTS = {
  dependents: 0.25,
  testCoverage: 0.20,
  changeVelocity: 0.15,
  errorHistory: 0.15,
  exportSurface: 0.10,
  complexity: 0.10,
  manualOverride: 0.05,
};

// ============================================================================
// Signal Scoring (each produces a 0-10 score)
// ============================================================================

/**
 * Score based on how many files depend on this one.
 * 0 deps = 0, 1-2 = 3, 3-5 = 5, 6-10 = 7, 11-20 = 8, 21+ = 10
 */
function scoreDependents(count: number): number {
  if (count >= 21) return 10;
  if (count >= 11) return 8;
  if (count >= 6) return 7;
  if (count >= 3) return 5;
  if (count >= 1) return 3;
  return 0;
}

/**
 * Score based on test coverage inverse.
 * Has tests = 0, no tests but low dependents = 5, no tests + many deps = 10
 */
function scoreTestCoverage(hasTests: boolean, dependentCount: number): number {
  if (hasTests) return 0;
  // No tests — score based on how critical the file is
  if (dependentCount >= 5) return 10;
  if (dependentCount >= 2) return 7;
  if (dependentCount >= 1) return 5;
  return 3; // No tests, no dependents — still some risk
}

/**
 * Score based on change velocity (changes per week, recent 30 days).
 * 0 changes = 0, 1-2/week = 3, 3-5/week = 6, 6+/week = 9
 */
function scoreVelocity(velocityScore: number): number {
  if (velocityScore >= 6) return 9;
  if (velocityScore >= 3) return 6;
  if (velocityScore >= 1) return 3;
  return 0;
}

/**
 * Score based on error history in the last 90 days.
 * 0 errors = 0, 1-2 = 4, 3-5 = 7, 6+ = 10
 */
function scoreErrors(count: number): number {
  if (count >= 6) return 10;
  if (count >= 3) return 7;
  if (count >= 1) return 4;
  return 0;
}

/**
 * Score based on export surface area.
 * 0-2 exports = 0, 3-5 = 3, 6-10 = 5, 11-20 = 7, 21+ = 9
 */
function scoreExports(count: number): number {
  if (count >= 21) return 9;
  if (count >= 11) return 7;
  if (count >= 6) return 5;
  if (count >= 3) return 3;
  return 0;
}

/**
 * Score based on complexity proxy (symbol count as density indicator).
 * 0-5 symbols = 0, 6-15 = 3, 16-30 = 5, 31-50 = 7, 51+ = 9
 */
function scoreComplexity(symbolCount: number): number {
  if (symbolCount >= 51) return 9;
  if (symbolCount >= 31) return 7;
  if (symbolCount >= 16) return 5;
  if (symbolCount >= 6) return 3;
  return 0;
}

/**
 * Score from manual override — user-set fragility as a small bias.
 */
function scoreOverride(manualFragility: number | null): number {
  if (manualFragility === null) return 0;
  return manualFragility;
}

// ============================================================================
// Composite Score
// ============================================================================

/**
 * Compute composite fragility score from all signals.
 */
function computeCompositeScore(signals: FragilitySignals): number {
  const weighted =
    signals.dependentScore * WEIGHTS.dependents +
    signals.testScore * WEIGHTS.testCoverage +
    signals.velocityScore * WEIGHTS.changeVelocity +
    signals.errorScore * WEIGHTS.errorHistory +
    signals.exportScore * WEIGHTS.exportSurface +
    signals.complexityScore * WEIGHTS.complexity +
    signals.overrideScore * WEIGHTS.manualOverride;

  // Round to nearest integer, clamp 1-10
  return Math.max(1, Math.min(10, Math.round(weighted)));
}

/**
 * Generate human-readable explanation of score drivers.
 */
function buildExplanation(score: number, signals: FragilitySignals): string {
  const parts: string[] = [];

  // Show top 3 contributing factors
  const factors = [
    { name: "dependents", value: signals.dependentScore * WEIGHTS.dependents, detail: `${signals.dependentCount} callers` },
    { name: "no tests", value: signals.testScore * WEIGHTS.testCoverage, detail: signals.testCoverage > 0 ? "has tests" : "no tests" },
    { name: "velocity", value: signals.velocityScore * WEIGHTS.changeVelocity, detail: `velocity ${signals.changeVelocity.toFixed(1)}` },
    { name: "errors", value: signals.errorScore * WEIGHTS.errorHistory, detail: `${signals.errorCount} recent errors` },
    { name: "exports", value: signals.exportScore * WEIGHTS.exportSurface, detail: `${signals.exportCount} exports` },
    { name: "complexity", value: signals.complexityScore * WEIGHTS.complexity, detail: `${signals.complexity} symbols` },
  ].filter((f) => f.value > 0);

  factors.sort((a, b) => b.value - a.value);

  for (const factor of factors.slice(0, 3)) {
    parts.push(factor.detail);
  }

  return `fragility ${score}: ${parts.join(", ")}`;
}

// ============================================================================
// Data Collection
// ============================================================================

/**
 * Compute fragility for a single file by gathering all signals from DB.
 */
async function computeFileFragility(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<FragilityResult | null> {
  try {
    // Get current file data
    const file = await db.get<{
      fragility: number;
      velocity_score: number;
      change_count: number;
    }>(
      `SELECT fragility, velocity_score, change_count FROM files
       WHERE project_id = ? AND path = ?`,
      [projectId, filePath]
    );

    if (!file) return null;

    // Count dependents from call graph
    const depResult = await db.get<{ cnt: number }>(
      `SELECT COUNT(DISTINCT caller_file) as cnt FROM call_graph
       WHERE project_id = ? AND callee_file = ?`,
      [projectId, filePath]
    );
    const dependentCount = depResult?.cnt ?? 0;

    // Check test coverage
    const testResult = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM test_source_map
       WHERE project_id = ? AND source_file = ?`,
      [projectId, filePath]
    );
    const hasTests = (testResult?.cnt ?? 0) > 0;

    // Count recent errors (last 90 days)
    const errorResult = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM error_events
       WHERE project_id = ? AND file_path = ?
       AND created_at > datetime('now', '-90 days')`,
      [projectId, filePath]
    );
    const errorCount = errorResult?.cnt ?? 0;

    // Count exports from symbols table
    const exportResult = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM symbols
       WHERE project_id = ? AND file_path = ? AND is_exported = 1`,
      [projectId, filePath]
    );
    const exportCount = exportResult?.cnt ?? 0;

    // Count total symbols as complexity proxy
    const symbolResult = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM symbols
       WHERE project_id = ? AND file_path = ?`,
      [projectId, filePath]
    );
    const symbolCount = symbolResult?.cnt ?? 0;

    const velocity = file.velocity_score ?? 0;

    // Compute individual signal scores
    const signals: FragilitySignals = {
      dependentCount,
      dependentScore: scoreDependents(dependentCount),
      testCoverage: hasTests ? 1 : 0,
      testScore: scoreTestCoverage(hasTests, dependentCount),
      changeVelocity: velocity,
      velocityScore: scoreVelocity(velocity),
      errorCount,
      errorScore: scoreErrors(errorCount),
      exportCount,
      exportScore: scoreExports(exportCount),
      complexity: symbolCount,
      complexityScore: scoreComplexity(symbolCount),
      manualOverride: file.fragility > 0 ? file.fragility : null,
      overrideScore: scoreOverride(file.fragility > 0 ? file.fragility : null),
    };

    const score = computeCompositeScore(signals);
    const explanation = buildExplanation(score, signals);

    return { filePath, score, signals, explanation };
  } catch {
    return null;
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Compute and persist fragility scores for all tracked files.
 * Called from background worker after call graph and test map builds.
 */
export async function computeProjectFragility(
  db: DatabaseAdapter,
  projectId: number,
  maxFiles: number = 500
): Promise<{ computed: number; updated: number }> {
  let computed = 0;
  let updated = 0;

  try {
    // Get all tracked files for this project
    const files = await db.all<{ path: string }>(
      `SELECT path FROM files WHERE project_id = ?
       ORDER BY fragility DESC, change_count DESC
       LIMIT ?`,
      [projectId, maxFiles]
    );

    for (const file of files) {
      const result = await computeFileFragility(db, projectId, file.path);
      if (!result) continue;

      computed++;

      // Persist: update fragility + store signal breakdown
      await db.run(
        `UPDATE files SET
           fragility = ?,
           fragility_signals = ?,
           fragility_computed_at = datetime('now'),
           updated_at = datetime('now')
         WHERE project_id = ? AND path = ?`,
        [result.score, JSON.stringify(result.signals), projectId, result.filePath]
      );
      updated++;
    }
  } catch {
    // Tables might not exist
  }

  return { computed, updated };
}

/**
 * Get the fragility explanation for a single file (for enrichment).
 */
export async function getFragilityExplanation(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<string | null> {
  try {
    const file = await db.get<{ fragility_signals: string | null }>(
      `SELECT fragility_signals FROM files
       WHERE project_id = ? AND path = ?`,
      [projectId, filePath]
    );

    if (!file?.fragility_signals) return null;

    const signals = JSON.parse(file.fragility_signals) as FragilitySignals;
    const score = computeCompositeScore(signals);
    return buildExplanation(score, signals);
  } catch {
    return null;
  }
}
