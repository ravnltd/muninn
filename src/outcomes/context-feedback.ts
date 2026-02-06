/**
 * Context Feedback Loop — Learn which context types are most useful
 *
 * Analyzes context_injections table:
 * - Was injected context actually used? (was_used flag)
 * - Did the session succeed?
 * - Compute usefulness ratio per context_type
 * - Feed into budget allocations for future sessions
 *
 * Runs at session end — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface ContextTypeStats {
  contextType: string;
  totalInjections: number;
  usedCount: number;
  useRate: number;
  avgRelevanceScore: number;
  successCorrelation: number;
}

export interface BudgetRecommendation {
  contextType: string;
  currentBudget: number;
  recommendedBudget: number;
  reason: string;
}

// ============================================================================
// Default Budget Allocation (must match budget-manager.ts)
// ============================================================================

const DEFAULT_BUDGETS: Record<string, number> = {
  criticalWarnings: 400,
  decisions: 400,
  learnings: 400,
  fileContext: 400,
  errorFixes: 200,
  reserve: 200,
};

// ============================================================================
// Usage Analysis
// ============================================================================

/**
 * Mark context injections as used based on session activity.
 * A context injection is "used" if the AI referenced the related file/decision.
 */
export async function markUsedContext(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<number> {
  let marked = 0;

  try {
    // Get files touched in this session
    const touchedFiles = await db.all<{ file_path: string }>(
      `SELECT DISTINCT json_each.value as file_path
       FROM tool_calls, json_each(files_involved)
       WHERE tool_calls.project_id = ? AND tool_calls.session_id = ?
       AND files_involved IS NOT NULL`,
      [projectId, sessionId]
    );

    const touchedSet = new Set(touchedFiles.map((f) => f.file_path));

    // Get context injections for this session
    const injections = await db.all<{ id: number; context_type: string; item_path: string | null }>(
      `SELECT ci.id, ci.context_type,
              CASE ci.context_type
                WHEN 'file' THEN (SELECT path FROM files WHERE id = ci.source_id)
                ELSE NULL
              END as item_path
       FROM context_injections ci
       WHERE ci.project_id = ? AND ci.session_id = ?`,
      [projectId, sessionId]
    );

    for (const injection of injections) {
      let used = false;

      // File context is "used" if the file was touched
      if (injection.item_path && touchedSet.has(injection.item_path)) {
        used = true;
      }

      // Decision/learning context is always considered partially used
      // (it informed the AI's approach even if not directly referenced)
      if (injection.context_type === "decision" || injection.context_type === "learning") {
        used = true;
      }

      if (used) {
        await db.run(
          `UPDATE context_injections SET was_used = 1 WHERE id = ?`,
          [injection.id]
        );
        marked++;
      }
    }
  } catch {
    // Tables might not exist
  }

  return marked;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Compute usefulness statistics per context type.
 */
export async function computeContextStats(
  db: DatabaseAdapter,
  projectId: number,
  windowSessions: number = 30
): Promise<ContextTypeStats[]> {
  try {
    const stats = await db.all<{
      context_type: string;
      total_injections: number;
      used_count: number;
      avg_relevance: number;
    }>(
      `SELECT context_type,
              COUNT(*) as total_injections,
              SUM(was_used) as used_count,
              AVG(relevance_score) as avg_relevance
       FROM context_injections
       WHERE project_id = ?
       AND session_id IN (
         SELECT id FROM sessions WHERE project_id = ?
         ORDER BY started_at DESC LIMIT ?
       )
       GROUP BY context_type`,
      [projectId, projectId, windowSessions]
    );

    // Compute success correlation: sessions with this context type that succeeded
    const results: ContextTypeStats[] = [];

    for (const stat of stats) {
      const successRate = await computeSuccessCorrelation(
        db, projectId, stat.context_type, windowSessions
      );

      results.push({
        contextType: stat.context_type,
        totalInjections: stat.total_injections,
        usedCount: stat.used_count,
        useRate: stat.total_injections > 0 ? stat.used_count / stat.total_injections : 0,
        avgRelevanceScore: stat.avg_relevance || 0,
        successCorrelation: successRate,
      });
    }

    return results;
  } catch {
    return [];
  }
}

async function computeSuccessCorrelation(
  db: DatabaseAdapter,
  projectId: number,
  contextType: string,
  windowSessions: number
): Promise<number> {
  try {
    const result = await db.get<{ success_rate: number }>(
      `SELECT AVG(CASE WHEN s.outcome = 'success' THEN 1.0 ELSE 0.0 END) as success_rate
       FROM context_injections ci
       JOIN sessions s ON ci.session_id = s.id
       WHERE ci.project_id = ? AND ci.context_type = ?
       AND s.ended_at IS NOT NULL
       AND ci.session_id IN (
         SELECT id FROM sessions WHERE project_id = ?
         ORDER BY started_at DESC LIMIT ?
       )`,
      [projectId, contextType, projectId, windowSessions]
    );
    return result?.success_rate || 0;
  } catch {
    return 0;
  }
}

// ============================================================================
// Budget Recommendations
// ============================================================================

/**
 * Generate budget recommendations based on context usage data.
 * High-use types get more tokens, low-use types get less.
 */
export async function generateBudgetRecommendations(
  db: DatabaseAdapter,
  projectId: number
): Promise<BudgetRecommendation[]> {
  const stats = await computeContextStats(db, projectId);
  if (stats.length === 0) return [];

  const recommendations: BudgetRecommendation[] = [];

  // Map context_type to budget category
  const typeToCategory: Record<string, string> = {
    warning: "criticalWarnings",
    decision: "decisions",
    learning: "learnings",
    file: "fileContext",
    error_fix: "errorFixes",
  };

  for (const stat of stats) {
    const category = typeToCategory[stat.contextType];
    if (!category) continue;

    const currentBudget = DEFAULT_BUDGETS[category] || 200;
    let recommendedBudget = currentBudget;
    let reason = "No change needed";

    // High use rate + high success correlation -> increase budget
    if (stat.useRate >= 0.7 && stat.successCorrelation >= 0.6) {
      recommendedBudget = Math.min(600, Math.round(currentBudget * 1.3));
      reason = `High usefulness: ${Math.round(stat.useRate * 100)}% use rate, ${Math.round(stat.successCorrelation * 100)}% success correlation`;
    }
    // Low use rate -> decrease budget
    else if (stat.useRate < 0.3 && stat.totalInjections >= 10) {
      recommendedBudget = Math.max(100, Math.round(currentBudget * 0.7));
      reason = `Low usefulness: only ${Math.round(stat.useRate * 100)}% use rate across ${stat.totalInjections} injections`;
    }

    if (recommendedBudget !== currentBudget) {
      recommendations.push({
        contextType: stat.contextType,
        currentBudget,
        recommendedBudget,
        reason,
      });
    }
  }

  return recommendations;
}

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Process context feedback for a completed session.
 * Called at session end from background worker.
 */
export async function processContextFeedback(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<{ marked: number; recommendations: BudgetRecommendation[] }> {
  const marked = await markUsedContext(db, projectId, sessionId);
  const recommendations = await generateBudgetRecommendations(db, projectId);

  return { marked, recommendations };
}
