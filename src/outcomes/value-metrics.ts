/**
 * Value Metrics — Health Score + ROI tracking
 *
 * Aggregates measurable value that Muninn provides:
 * - Health score: 0-100 composite from 5 weighted components
 * - ROI metrics: monthly aggregation of context delivery stats
 *
 * v6 Wave 1B — runs as background worker jobs, never in MCP hot path.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface HealthScoreComponent {
  name: string;
  score: number;    // 0-100
  weight: number;   // 0-1
  detail: string;   // Human description
}

export interface HealthScore {
  overall: number;           // 0-100 weighted composite
  components: HealthScoreComponent[];
  computedAt: string;        // ISO timestamp
}

export interface RoiMetrics {
  month: string;                    // YYYY-MM
  contradictionsPrevented: number;
  contextInjections: number;
  contextHitRate: number;           // % with relevance_signal = 'positive'
  decisionsRecalled: number;
  learningsApplied: number;
  sessionsWithContext: number;
  totalSessions: number;
}

// ============================================================================
// Health Score Components
// ============================================================================

async function computeFragilityDistribution(
  db: DatabaseAdapter,
  projectId: number
): Promise<HealthScoreComponent> {
  try {
    const result = await db.get<{ avg_frag: number }>(
      `SELECT AVG(fragility) as avg_frag FROM files WHERE project_id = ?`,
      [projectId]
    );
    const avgFragility = result?.avg_frag ?? 5;
    const score = Math.max(0, 100 - avgFragility * 10);
    return {
      name: "Fragility Distribution",
      score: Math.round(score),
      weight: 0.25,
      detail: `Average fragility: ${avgFragility.toFixed(1)}/10`,
    };
  } catch {
    return { name: "Fragility Distribution", score: 50, weight: 0.25, detail: "No data" };
  }
}

async function computeDecisionSuccessRate(
  db: DatabaseAdapter,
  projectId: number
): Promise<HealthScoreComponent> {
  try {
    const result = await db.get<{ total: number; succeeded: number }>(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN outcome = 'succeeded' THEN 1 ELSE 0 END) as succeeded
       FROM decisions WHERE project_id = ? AND outcome IS NOT NULL`,
      [projectId]
    );
    if (!result || result.total === 0) {
      return { name: "Decision Success Rate", score: 50, weight: 0.20, detail: "No decisions tracked" };
    }
    const rate = result.succeeded / result.total;
    return {
      name: "Decision Success Rate",
      score: Math.round(rate * 100),
      weight: 0.20,
      detail: `${result.succeeded}/${result.total} succeeded`,
    };
  } catch {
    return { name: "Decision Success Rate", score: 50, weight: 0.20, detail: "No data" };
  }
}

async function computeLearningConfidence(
  db: DatabaseAdapter,
  projectId: number
): Promise<HealthScoreComponent> {
  try {
    const result = await db.get<{ avg_conf: number; count: number }>(
      `SELECT AVG(confidence) as avg_conf, COUNT(*) as count
       FROM learnings WHERE project_id = ?`,
      [projectId]
    );
    if (!result || result.count === 0) {
      return { name: "Learning Confidence", score: 50, weight: 0.20, detail: "No learnings" };
    }
    const score = (result.avg_conf / 10) * 100;
    return {
      name: "Learning Confidence",
      score: Math.round(Math.min(100, score)),
      weight: 0.20,
      detail: `Avg confidence: ${result.avg_conf.toFixed(1)}/10 across ${result.count} learnings`,
    };
  } catch {
    return { name: "Learning Confidence", score: 50, weight: 0.20, detail: "No data" };
  }
}

async function computeIssueResolution(
  db: DatabaseAdapter,
  projectId: number
): Promise<HealthScoreComponent> {
  try {
    const result = await db.get<{ total: number; resolved: number }>(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
       FROM issues WHERE project_id = ?`,
      [projectId]
    );
    if (!result || result.total === 0) {
      return { name: "Issue Resolution", score: 80, weight: 0.20, detail: "No issues tracked" };
    }
    const rate = result.resolved / result.total;
    return {
      name: "Issue Resolution",
      score: Math.round(rate * 100),
      weight: 0.20,
      detail: `${result.resolved}/${result.total} resolved`,
    };
  } catch {
    return { name: "Issue Resolution", score: 80, weight: 0.20, detail: "No data" };
  }
}

async function computeKnowledgeFreshness(
  db: DatabaseAdapter,
  projectId: number
): Promise<HealthScoreComponent> {
  try {
    const result = await db.get<{ total: number; fresh: number }>(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN updated_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as fresh
       FROM files WHERE project_id = ?`,
      [projectId]
    );
    if (!result || result.total === 0) {
      return { name: "Knowledge Freshness", score: 50, weight: 0.15, detail: "No files tracked" };
    }
    const rate = result.fresh / result.total;
    return {
      name: "Knowledge Freshness",
      score: Math.round(rate * 100),
      weight: 0.15,
      detail: `${result.fresh}/${result.total} files updated in last 30 days`,
    };
  } catch {
    return { name: "Knowledge Freshness", score: 50, weight: 0.15, detail: "No data" };
  }
}

// ============================================================================
// Health Score
// ============================================================================

/**
 * Compute a 0-100 health score from 5 weighted components.
 */
export async function computeHealthScore(
  db: DatabaseAdapter,
  projectId: number
): Promise<HealthScore> {
  const components = await Promise.all([
    computeFragilityDistribution(db, projectId),
    computeDecisionSuccessRate(db, projectId),
    computeLearningConfidence(db, projectId),
    computeIssueResolution(db, projectId),
    computeKnowledgeFreshness(db, projectId),
  ]);

  const overall = components.reduce(
    (sum, c) => sum + c.score * c.weight,
    0
  );

  return {
    overall: Math.round(overall),
    components,
    computedAt: new Date().toISOString(),
  };
}

// ============================================================================
// ROI Metrics
// ============================================================================

function getMonthStart(monthStart?: string): string {
  if (monthStart) return monthStart;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function getMonth(monthStart: string): string {
  return monthStart.slice(0, 7);
}

/**
 * Aggregate value metrics for a given month.
 */
export async function computeRoiMetrics(
  db: DatabaseAdapter,
  projectId: number,
  monthStart?: string
): Promise<RoiMetrics> {
  const start = getMonthStart(monthStart);
  const month = getMonth(start);

  const [contradictions, injections, decisions, learnings, sessions] = await Promise.all([
    queryContradictions(db, projectId, start),
    queryContextInjections(db, projectId, start),
    queryDecisionsRecalled(db, projectId, start),
    queryLearningsApplied(db, projectId, start),
    querySessions(db, projectId, start),
  ]);

  const hitRate = injections.total > 0 ? injections.hits / injections.total : 0;

  return {
    month,
    contradictionsPrevented: contradictions,
    contextInjections: injections.total,
    contextHitRate: Math.round(hitRate * 100),
    decisionsRecalled: decisions,
    learningsApplied: learnings,
    sessionsWithContext: sessions.withContext,
    totalSessions: sessions.total,
  };
}

async function queryContradictions(
  db: DatabaseAdapter,
  projectId: number,
  start: string
): Promise<number> {
  try {
    const result = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM contradiction_alerts
       WHERE project_id = ? AND created_at >= ?`,
      [projectId, start]
    );
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

async function queryContextInjections(
  db: DatabaseAdapter,
  projectId: number,
  start: string
): Promise<{ total: number; hits: number }> {
  try {
    const result = await db.get<{ total: number; hits: number }>(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN relevance_signal = 'positive' THEN 1 ELSE 0 END) as hits
       FROM context_injections
       WHERE project_id = ? AND created_at >= ?`,
      [projectId, start]
    );
    return { total: result?.total ?? 0, hits: result?.hits ?? 0 };
  } catch {
    return { total: 0, hits: 0 };
  }
}

async function queryDecisionsRecalled(
  db: DatabaseAdapter,
  projectId: number,
  start: string
): Promise<number> {
  try {
    const result = await db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT source_id) as count FROM context_injections
       WHERE project_id = ? AND context_type = 'decisions' AND created_at >= ?`,
      [projectId, start]
    );
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

async function queryLearningsApplied(
  db: DatabaseAdapter,
  projectId: number,
  start: string
): Promise<number> {
  try {
    const result = await db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT source_id) as count FROM context_injections
       WHERE project_id = ? AND context_type = 'learnings' AND created_at >= ?`,
      [projectId, start]
    );
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

async function querySessions(
  db: DatabaseAdapter,
  projectId: number,
  start: string
): Promise<{ total: number; withContext: number }> {
  try {
    const result = await db.get<{ total: number; with_context: number }>(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN files_touched IS NOT NULL THEN 1 ELSE 0 END) as with_context
       FROM sessions
       WHERE project_id = ? AND started_at >= ?`,
      [projectId, start]
    );
    return { total: result?.total ?? 0, withContext: result?.with_context ?? 0 };
  } catch {
    return { total: 0, withContext: 0 };
  }
}

// ============================================================================
// Monthly Aggregation
// ============================================================================

/**
 * Aggregate and store metrics for the current month in the value_metrics table.
 */
export async function aggregateMonthlyMetrics(
  db: DatabaseAdapter,
  projectId: number
): Promise<void> {
  const metrics = await computeRoiMetrics(db, projectId);

  try {
    await db.run(
      `INSERT INTO value_metrics (
        project_id, month, contradictions_prevented, context_injections,
        context_hit_rate, decisions_recalled, learnings_applied,
        sessions_with_context, total_sessions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, month) DO UPDATE SET
        contradictions_prevented = excluded.contradictions_prevented,
        context_injections = excluded.context_injections,
        context_hit_rate = excluded.context_hit_rate,
        decisions_recalled = excluded.decisions_recalled,
        learnings_applied = excluded.learnings_applied,
        sessions_with_context = excluded.sessions_with_context,
        total_sessions = excluded.total_sessions`,
      [
        projectId,
        metrics.month,
        metrics.contradictionsPrevented,
        metrics.contextInjections,
        metrics.contextHitRate,
        metrics.decisionsRecalled,
        metrics.learningsApplied,
        metrics.sessionsWithContext,
        metrics.totalSessions,
      ]
    );
  } catch {
    // Table might not exist if migration hasn't run yet
  }
}
