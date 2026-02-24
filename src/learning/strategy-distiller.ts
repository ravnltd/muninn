/**
 * Strategy Distiller — v7 Phase 2B
 *
 * Distills strategies from reasoning traces.
 * When 3+ traces share a strategy tag with >60% success rate,
 * auto-creates a catalog entry.
 *
 * Success rates are updated via Bayesian stabilizing factor
 * (same as learning reinforcer).
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

interface StrategyCandidate {
  name: string;
  traceCount: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number;
  traceIds: number[];
}

// ============================================================================
// Constants
// ============================================================================

const MIN_TRACES = 3;
const MIN_SUCCESS_RATE = 0.6;

// ============================================================================
// Main
// ============================================================================

/**
 * Distill strategies from reasoning traces.
 * Runs every 5 sessions as a background job.
 */
export async function distillStrategies(
  db: DatabaseAdapter,
  projectId: number,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  // Collect strategy tag frequencies with outcomes
  const candidates = await findCandidates(db, projectId);

  for (const candidate of candidates) {
    if (candidate.traceCount >= MIN_TRACES && candidate.successRate >= MIN_SUCCESS_RATE) {
      const existing = await db.get<{ id: number; times_used: number; success_rate: number }>(
        `SELECT id, times_used, success_rate FROM strategy_catalog
         WHERE project_id = ? AND name = ?`,
        [projectId, candidate.name],
      );

      if (existing) {
        // Update existing strategy with Bayesian stabilized rate
        const newRate = bayesianUpdate(
          existing.success_rate,
          candidate.successRate,
          existing.times_used,
        );
        await db.run(
          `UPDATE strategy_catalog SET
             success_rate = ?,
             times_used = ?,
             avg_duration_ms = ?,
             source_trace_ids = ?,
             updated_at = datetime('now')
           WHERE id = ?`,
          [
            newRate,
            candidate.traceCount,
            candidate.avgDurationMs,
            JSON.stringify(candidate.traceIds),
            existing.id,
          ],
        );
        updated++;
      } else {
        // Create new strategy
        const description = generateDescription(candidate.name);
        await db.run(
          `INSERT INTO strategy_catalog
           (project_id, name, description, trigger_conditions, success_rate,
            times_used, avg_duration_ms, source_trace_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            projectId,
            candidate.name,
            description,
            JSON.stringify([]),
            candidate.successRate,
            candidate.traceCount,
            candidate.avgDurationMs,
            JSON.stringify(candidate.traceIds),
          ],
        );
        created++;
      }
    }
  }

  return { created, updated };
}

/**
 * Get strategies matching a task context.
 * Used by the budget manager to inject strategies into context.
 */
export async function getMatchingStrategies(
  db: DatabaseAdapter,
  projectId: number,
  keywords: string[],
  limit: number = 3,
): Promise<Array<{ name: string; description: string; successRate: number }>> {
  try {
    // Get all strategies above minimum success rate
    const strategies = await db.all<{
      name: string;
      description: string;
      success_rate: number;
      trigger_conditions: string;
    }>(
      `SELECT name, description, success_rate, trigger_conditions
       FROM strategy_catalog
       WHERE project_id = ? AND success_rate >= 0.5 AND times_used >= ${MIN_TRACES}
       ORDER BY success_rate DESC, times_used DESC
       LIMIT 10`,
      [projectId],
    );

    // Score strategies by keyword relevance
    const scored = strategies.map((s) => {
      let relevance = 0;
      const nameLower = s.name.toLowerCase();
      const descLower = s.description.toLowerCase();
      for (const keyword of keywords) {
        const kw = keyword.toLowerCase();
        if (nameLower.includes(kw)) relevance += 2;
        if (descLower.includes(kw)) relevance += 1;
      }
      return { ...s, relevance };
    });

    // Return top strategies (prioritize relevant ones, then high success rate)
    return scored
      .sort((a, b) => b.relevance - a.relevance || b.success_rate - a.success_rate)
      .slice(0, limit)
      .map((s) => ({
        name: s.name,
        description: s.description,
        successRate: s.success_rate,
      }));
  } catch {
    return [];
  }
}

// ============================================================================
// Candidate Discovery
// ============================================================================

async function findCandidates(
  db: DatabaseAdapter,
  projectId: number,
): Promise<StrategyCandidate[]> {
  try {
    const traces = await db.all<{
      id: number;
      strategy_tags: string;
      outcome: string;
      duration_ms: number | null;
    }>(
      `SELECT id, strategy_tags, outcome, duration_ms
       FROM reasoning_traces
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [projectId],
    );

    // Aggregate by strategy tag
    const tagMap = new Map<string, {
      traceIds: number[];
      successCount: number;
      totalDuration: number;
    }>();

    for (const trace of traces) {
      let tags: string[] = [];
      try { tags = JSON.parse(trace.strategy_tags); } catch { /* skip */ }

      for (const tag of tags) {
        const existing = tagMap.get(tag) ?? { traceIds: [], successCount: 0, totalDuration: 0 };
        existing.traceIds.push(trace.id);
        if (trace.outcome === "success") existing.successCount++;
        existing.totalDuration += trace.duration_ms ?? 0;
        tagMap.set(tag, existing);
      }
    }

    // Convert to candidates
    const candidates: StrategyCandidate[] = [];
    for (const [name, data] of tagMap) {
      const traceCount = data.traceIds.length;
      candidates.push({
        name,
        traceCount,
        successCount: data.successCount,
        successRate: traceCount > 0 ? data.successCount / traceCount : 0,
        avgDurationMs: traceCount > 0 ? Math.round(data.totalDuration / traceCount) : 0,
        traceIds: data.traceIds.slice(0, 20),
      });
    }

    return candidates;
  } catch {
    return [];
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Bayesian stabilized update for success rates.
 * Same formula as learning reinforcer: delta = 1/sqrt(times_applied + 1)
 */
function bayesianUpdate(
  currentRate: number,
  observedRate: number,
  timesUsed: number,
): number {
  const delta = 1 / Math.sqrt(timesUsed + 1);
  const newRate = currentRate + (observedRate - currentRate) * delta;
  return Math.max(0, Math.min(1, newRate));
}

/**
 * Generate a human-readable description for a strategy name.
 */
function generateDescription(name: string): string {
  const descriptions: Record<string, string> = {
    "review-before-edit": "Check context and query memory before modifying files",
    "error-driven-fix": "Search for error context, check affected file, apply targeted fix",
    "broad-exploration": "Suggest related files, check multiple before deciding on approach",
    "quick-fix": "Minimal check then direct modification for simple changes",
    "deep-research": "Multiple queries to build understanding before acting",
    "context-first": "Use unified context retrieval to get full picture before editing",
    "plan-then-execute": "Plan with predict and suggest, then execute methodically",
  };
  return descriptions[name] ?? `Strategy pattern: ${name.replace(/-/g, " ")}`;
}
