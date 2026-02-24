/**
 * Agent Profile — Behavioral Self-Awareness
 *
 * Computes per-task-type performance stats from the sessions table.
 * Three parallel queries via Promise.allSettled — resilient to missing tables.
 * Module-level cache — one computation per session lifetime.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface TaskTypeStats {
  taskType: string;
  total: number;
  successRate: number;
  avgDurationMinutes: number;
}

export interface AgentProfile {
  taskTypeStats: TaskTypeStats[];
  bestStrategy: { name: string; taskType: string; successRate: number } | null;
  worstTaskType: { type: string; successRate: number; total: number } | null;
  scopeCreepRate: number;
}

// ============================================================================
// Cache
// ============================================================================

let cachedProfile: AgentProfile | null = null;

export function clearProfileCache(): void {
  cachedProfile = null;
}

// ============================================================================
// Main
// ============================================================================

export async function getAgentProfile(
  db: DatabaseAdapter,
  projectId: number,
): Promise<AgentProfile> {
  if (cachedProfile) return cachedProfile;

  const [statsResult, strategyResult, scopeResult] = await Promise.allSettled([
    // Q1: Task type performance
    db.all<{
      task_type: string;
      total: number;
      success_rate: number;
      avg_duration_minutes: number;
    }>(
      `SELECT task_type, COUNT(*) as total,
        AVG(CASE WHEN success = 2 THEN 1.0 ELSE 0.0 END) as success_rate,
        AVG((julianday(ended_at) - julianday(started_at)) * 24 * 60) as avg_duration_minutes
       FROM sessions
       WHERE project_id = ? AND task_type IS NOT NULL AND ended_at IS NOT NULL
       GROUP BY task_type HAVING COUNT(*) >= 2`,
      [projectId],
    ),

    // Q2: Best strategy per task type
    db.get<{ task_type: string; name: string; success_rate: number }>(
      `SELECT s.task_type, sc.name, sc.success_rate
       FROM strategy_catalog sc
       JOIN reasoning_traces rt ON rt.project_id = sc.project_id
         AND rt.strategy_tags LIKE '%' || sc.name || '%'
       JOIN sessions s ON rt.session_id = s.id
       WHERE sc.project_id = ? AND sc.success_rate >= 0.5 AND sc.times_used >= 3
         AND s.task_type IS NOT NULL
       GROUP BY s.task_type, sc.name
       ORDER BY sc.success_rate DESC LIMIT 1`,
      [projectId],
    ),

    // Q3: Scope creep rate (sessions touching >5 files)
    db.get<{ rate: number }>(
      `SELECT CAST(SUM(CASE WHEN json_array_length(COALESCE(files_touched, '[]')) > 5
        THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) as rate
       FROM sessions WHERE project_id = ? AND ended_at IS NOT NULL AND task_type IS NOT NULL`,
      [projectId],
    ),
  ]);

  // Build task type stats
  const taskTypeStats: TaskTypeStats[] =
    statsResult.status === "fulfilled"
      ? statsResult.value.map((r) => ({
          taskType: r.task_type,
          total: r.total,
          successRate: r.success_rate,
          avgDurationMinutes: r.avg_duration_minutes ?? 0,
        }))
      : [];

  // Best strategy
  const bestStrategy =
    strategyResult.status === "fulfilled" && strategyResult.value
      ? {
          name: strategyResult.value.name,
          taskType: strategyResult.value.task_type,
          successRate: strategyResult.value.success_rate,
        }
      : null;

  // Worst task type (minimum 3 sessions before labeling)
  const qualifying = taskTypeStats.filter((s) => s.total >= 3);
  const worst = qualifying.length > 0
    ? qualifying.reduce((a, b) => (a.successRate < b.successRate ? a : b))
    : null;
  const worstTaskType = worst
    ? { type: worst.taskType, successRate: worst.successRate, total: worst.total }
    : null;

  // Scope creep rate
  const scopeCreepRate =
    scopeResult.status === "fulfilled" && scopeResult.value
      ? scopeResult.value.rate ?? 0
      : 0;

  cachedProfile = { taskTypeStats, bestStrategy, worstTaskType, scopeCreepRate };
  return cachedProfile;
}
