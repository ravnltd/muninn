/**
 * Intelligence Collector — v7 Loop Closure
 *
 * Single integration layer that gathers ALL intelligence signals in parallel.
 * Connects the 6 broken feedback loops to the context pipeline.
 *
 * All queries run via Promise.allSettled — resilient to missing tables.
 * Adds ~5-15ms total (parallel execution).
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { TrajectoryAnalysis } from "./trajectory-analyzer";

// ============================================================================
// Types
// ============================================================================

export interface StrategyEntry {
  name: string;
  description: string;
  successRate: number;
  timesUsed: number;
}

export interface BudgetAllocation {
  contradictions: number;
  criticalWarnings: number;
  strategies: number;
  decisions: number;
  learnings: number;
  fileContext: number;
  errorFixes: number;
  reserve: number;
}

export interface IntelligenceSignals {
  strategies: StrategyEntry[];
  staleItemIds: Set<string>;
  budgetOverrides: BudgetAllocation | null;
  prediction: { tool: string; confidence: number } | null;
  trajectory: TrajectoryAnalysis;
}

// ============================================================================
// Main
// ============================================================================

/**
 * Gather all intelligence signals in parallel.
 * Returns unified signals for injection into context pipeline.
 */
export async function collectIntelligence(
  db: DatabaseAdapter,
  projectId: number,
  keywords: string[],
  recentToolNames: string[],
): Promise<IntelligenceSignals> {
  const [strategiesResult, staleResult, budgetResult, predictionResult, trajectoryResult] =
    await Promise.allSettled([
      import("../learning/strategy-distiller.js").then((mod) =>
        mod.getMatchingStrategies(db, projectId, keywords),
      ),
      import("../outcomes/freshness-tracker.js").then((mod) =>
        mod.getStaleItems(db, projectId),
      ),
      import("./budget-manager.js").then((mod) =>
        mod.loadBudgetOverrides(db, projectId),
      ),
      import("./workflow-predictor.js").then((mod) =>
        mod.predictNextAction(db, projectId, recentToolNames),
      ),
      Promise.resolve().then(() => {
        const { analyzeTrajectory } = require("./trajectory-analyzer") as typeof import("./trajectory-analyzer");
        const callData = recentToolNames.map((toolName) => ({ toolName, files: [] }));
        return analyzeTrajectory(callData);
      }),
    ]);

  // Extract strategies with timesUsed (re-query for full data)
  let strategies: StrategyEntry[] = [];
  if (strategiesResult.status === "fulfilled" && strategiesResult.value.length > 0) {
    strategies = strategiesResult.value.map((s) => ({
      ...s,
      timesUsed: 0, // Basic strategies from getMatchingStrategies lack timesUsed
    }));
    // Enrich with timesUsed from catalog
    try {
      for (const strategy of strategies) {
        const row = await db.get<{ times_used: number }>(
          `SELECT times_used FROM strategy_catalog WHERE project_id = ? AND name = ?`,
          [projectId, strategy.name],
        );
        if (row) strategy.timesUsed = row.times_used;
      }
    } catch {
      // Table may not exist
    }
  }

  // Build stale item lookup Set
  const staleItemIds = new Set<string>();
  if (staleResult.status === "fulfilled") {
    for (const item of staleResult.value) {
      staleItemIds.add(`${item.sourceTable}:${item.sourceId}`);
    }
  }

  // Extract budget overrides
  const budgetOverrides =
    budgetResult.status === "fulfilled" ? budgetResult.value : null;

  // Extract prediction
  let prediction: { tool: string; confidence: number } | null = null;
  if (predictionResult.status === "fulfilled" && predictionResult.value) {
    const p = predictionResult.value;
    prediction = { tool: p.predictedTool, confidence: p.confidence };
  }

  // Extract trajectory
  const trajectory: TrajectoryAnalysis =
    trajectoryResult.status === "fulfilled"
      ? trajectoryResult.value
      : { pattern: "normal", message: "Analysis unavailable", confidence: 0 };

  return { strategies, staleItemIds, budgetOverrides, prediction, trajectory };
}
