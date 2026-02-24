/**
 * Dynamic Budget Allocator
 *
 * Takes intelligence signals and produces adjusted budget allocation.
 * This is the central fix for all 7 feedback loops — every signal
 * flows through here to affect context construction.
 */
import type { BudgetAllocation, IntelligenceSignals } from "./intelligence-collector.js";
import type { TrajectoryAnalysis } from "./trajectory-analyzer.js";

const DEFAULT_ALLOCATION: BudgetAllocation = {
  contradictions: 250,
  criticalWarnings: 300,
  strategies: 200,
  decisions: 300,
  learnings: 300,
  fileContext: 300,
  errorFixes: 150,
  reserve: 200,
};

function clamp(value: number, min: number = 100, max: number = 800): number {
  return Math.max(min, Math.min(max, value));
}

function applyTrajectoryAdjustments(
  alloc: BudgetAllocation,
  trajectory: TrajectoryAnalysis,
): BudgetAllocation {
  if (trajectory.confidence < 0.5) return alloc;

  const result = { ...alloc };

  switch (trajectory.pattern) {
    case "exploration":
      result.fileContext = clamp(Math.round(alloc.fileContext * 1.4));
      result.strategies = clamp(Math.round(alloc.strategies * 1.2));
      break;
    case "failing":
      result.errorFixes = clamp(Math.round(alloc.errorFixes * 1.5));
      result.criticalWarnings = clamp(Math.round(alloc.criticalWarnings * 1.3));
      break;
    case "stuck":
      result.strategies = clamp(Math.round(alloc.strategies * 1.5));
      result.fileContext = clamp(Math.round(alloc.fileContext * 1.3));
      break;
    case "confident":
      result.reserve = clamp(Math.round(alloc.reserve * 0.7));
      break;
  }

  return result;
}

function applyImpactAdjustments(
  alloc: BudgetAllocation,
  impactStats: Record<string, { helped: number; irrelevant: number; total: number }> | null,
): BudgetAllocation {
  if (!impactStats) return alloc;

  const result = { ...alloc };
  const categoryMap: Record<string, keyof BudgetAllocation> = {
    decisions: "decisions",
    learnings: "learnings",
    files: "fileContext",
    error_fixes: "errorFixes",
    warnings: "criticalWarnings",
    strategies: "strategies",
  };

  for (const [type, stats] of Object.entries(impactStats)) {
    const key = categoryMap[type];
    if (!key || stats.total < 5) continue;

    const helpRate = stats.helped / stats.total;
    const irrelevantRate = stats.irrelevant / stats.total;

    if (irrelevantRate > 0.5) {
      result[key] = clamp(Math.round(result[key] * 0.8));
    } else if (helpRate > 0.6) {
      result[key] = clamp(Math.round(result[key] * 1.2));
    }
  }

  return result;
}

function applyStalenessAdjustments(
  alloc: BudgetAllocation,
  staleItemIds: Set<string>,
): BudgetAllocation {
  if (staleItemIds.size === 0) return alloc;

  const result = { ...alloc };
  const staleCount = staleItemIds.size;

  // If many stale items, reduce their categories slightly
  // to make room for fresh content
  if (staleCount >= 5) {
    result.decisions = clamp(Math.round(alloc.decisions * 0.85));
    result.learnings = clamp(Math.round(alloc.learnings * 0.85));
  }

  return result;
}

export function computeDynamicBudget(
  signals: IntelligenceSignals,
  baseOverrides: BudgetAllocation | null,
  impactStats: Record<string, { helped: number; irrelevant: number; total: number }> | null,
): BudgetAllocation {
  // 1. Start with DB overrides or defaults
  let alloc = baseOverrides ?? { ...DEFAULT_ALLOCATION };

  // 2. Apply impact-based adjustments (Loop 4)
  alloc = applyImpactAdjustments(alloc, impactStats);

  // 3. Apply staleness adjustments (Loop 3)
  alloc = applyStalenessAdjustments(alloc, signals.staleItemIds);

  // 4. Apply trajectory adjustments (Loop 7) — last, most situational
  alloc = applyTrajectoryAdjustments(alloc, signals.trajectory);

  return alloc;
}

export { DEFAULT_ALLOCATION };
