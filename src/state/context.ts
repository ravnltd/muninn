/**
 * Calibrated Context Builder
 *
 * Builds context output with budget weights and overrides applied.
 */
import { applyWeightAdjustments, buildContextOutput } from "../context/budget-manager.js";
import type { TaskContext } from "../context/task-analyzer.js";
import type { BudgetOverrides } from "./session.js";

const DEFAULT_ALLOCATION: BudgetOverrides = {
  contradictions: 250,
  criticalWarnings: 300,
  strategies: 200,
  decisions: 300,
  learnings: 300,
  fileContext: 300,
  errorFixes: 150,
  reserve: 200,
};

export function buildCalibratedContext(
  ctx: TaskContext,
  budget?: number,
  overrides?: BudgetOverrides | null,
  weights?: Record<string, number>,
): string {
  const baseAlloc = overrides ?? DEFAULT_ALLOCATION;
  const adjusted = applyWeightAdjustments(baseAlloc, weights ?? {});
  return buildContextOutput(ctx, budget, adjusted);
}

export { DEFAULT_ALLOCATION };
