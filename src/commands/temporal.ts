/**
 * Temporal Intelligence
 * Applies time-aware scoring to search results, tracks file velocity,
 * and detects anomalous change patterns.
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { QueryResult } from "../types";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Temporal Scoring
// ============================================================================

/**
 * Re-rank results by recency + frequency + velocity.
 * Applied after focus boost in the search pipeline.
 */
export async function applyTemporalScoring(results: QueryResult[], db: DatabaseAdapter, projectId: number): Promise<QueryResult[]> {
  if (results.length === 0) return results;

  const scoredResults: QueryResult[] = [];
  for (const r of results) {
    let temporalBoost = 0;

    if (r.type === "file") {
      const fileInfo = await getFileTemporalInfo(db, projectId, r.title);
      if (fileInfo) {
        // Velocity boost: faster-changing files are more relevant now
        temporalBoost += Math.min(0.3, fileInfo.velocity_score * 0.1);
        // Recency boost: recently changed files
        if (fileInfo.temperature === "hot") temporalBoost += 0.2;
        else if (fileInfo.temperature === "warm") temporalBoost += 0.1;
      }
    }

    // For decisions/learnings, hot items get boosted
    if (["decision", "learning", "issue"].includes(r.type)) {
      const tempInfo = await getEntityTemperature(db, r.type, r.id);
      if (tempInfo === "hot") temporalBoost += 0.2;
      else if (tempInfo === "warm") temporalBoost += 0.1;
    }

    // Lower relevance = better for bm25 scores
    scoredResults.push({ ...r, relevance: r.relevance - temporalBoost });
  }

  return scoredResults.sort((a, b) => a.relevance - b.relevance);
}

async function getFileTemporalInfo(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<{ velocity_score: number; temperature: string } | null> {
  try {
    return (
      await db.get<{ velocity_score: number; temperature: string }>(`
      SELECT COALESCE(velocity_score, 0) as velocity_score, COALESCE(temperature, 'cold') as temperature
      FROM files WHERE project_id = ? AND path = ?
    `, [projectId, filePath]) ?? null
    );
  } catch {
    return null;
  }
}

async function getEntityTemperature(db: DatabaseAdapter, type: string, id: number): Promise<string | null> {
  const tableMap: Record<string, string> = {
    decision: "decisions",
    learning: "learnings",
    issue: "issues",
    file: "files",
  };
  const table = tableMap[type];
  if (!table) return null;

  try {
    const result = await db.get<{ temperature: string }>(
      `SELECT COALESCE(temperature, 'cold') as temperature FROM ${table} WHERE id = ?`,
      [id]
    );
    return result?.temperature ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Velocity Calculation
// ============================================================================

/**
 * Calculate file velocity: changes per session with exponential decay.
 * Higher velocity = file is in active development.
 */
export async function calculateVelocity(db: DatabaseAdapter, projectId: number, filePath: string): Promise<number> {
  try {
    const fileInfo = await db.get<{ change_count: number; first_changed_at: string | null }>(`
      SELECT COALESCE(change_count, 0) as change_count, first_changed_at
      FROM files WHERE project_id = ? AND path = ?
    `, [projectId, filePath]);

    if (!fileInfo || fileInfo.change_count === 0) return 0;

    // Get total sessions since first change
    const sessionCount = await db.get<{ count: number }>(`
      SELECT COUNT(*) as count FROM sessions
      WHERE project_id = ?
        AND started_at >= COALESCE(?, '2000-01-01')
    `, [projectId, fileInfo.first_changed_at ?? "2000-01-01"]);

    const sessions = sessionCount?.count || 1;
    return fileInfo.change_count / Math.max(1, sessions);
  } catch {
    return 0;
  }
}

/**
 * Update velocities for files touched in a session.
 * Called at session end.
 */
export async function updateFileVelocity(db: DatabaseAdapter, projectId: number, files: string[]): Promise<void> {
  for (const filePath of files) {
    try {
      await db.run(
        `
        UPDATE files SET
          change_count = COALESCE(change_count, 0) + 1,
          first_changed_at = COALESCE(first_changed_at, CURRENT_TIMESTAMP),
          velocity_score = CAST(COALESCE(change_count, 0) + 1 AS REAL) /
            MAX(1, (SELECT COUNT(*) FROM sessions WHERE project_id = ?
                    AND started_at >= COALESCE(files.first_changed_at, '2000-01-01')))
        WHERE project_id = ? AND path = ?
      `,
        [projectId, projectId, filePath]
      );
    } catch {
      // velocity columns might not exist
    }
  }
}

// ============================================================================
// Session Number Assignment
// ============================================================================

/**
 * Assign a monotonically increasing session number per project.
 * Called on session start.
 */
export async function assignSessionNumber(db: DatabaseAdapter, projectId: number, sessionId: number): Promise<number> {
  try {
    const maxNum = await db.get<{ max_num: number | null }>(`
      SELECT MAX(session_number) as max_num FROM sessions WHERE project_id = ?
    `, [projectId]);

    const nextNum = (maxNum?.max_num ?? 0) + 1;

    await db.run(
      `
      UPDATE sessions SET session_number = ? WHERE id = ?
    `,
      [nextNum, sessionId]
    );

    return nextNum;
  } catch {
    return 0; // Column might not exist
  }
}

// ============================================================================
// Anomaly Detection
// ============================================================================

/**
 * Detect files with unusual velocity (significant change from baseline).
 */
export async function detectAnomalies(
  db: DatabaseAdapter,
  projectId: number
): Promise<Array<{ path: string; velocity_score: number; change_count: number; anomaly: string }>> {
  try {
    // Get average velocity across all files
    const avg = await db.get<{ avg_velocity: number }>(`
      SELECT AVG(COALESCE(velocity_score, 0)) as avg_velocity FROM files
      WHERE project_id = ? AND velocity_score > 0
    `, [projectId]);

    const avgVelocity = avg?.avg_velocity ?? 0;
    if (avgVelocity === 0) return [];

    // Find files with velocity > 2x average
    const anomalies = await db.all<{
      path: string;
      velocity_score: number;
      change_count: number;
    }>(`
      SELECT path, velocity_score, change_count FROM files
      WHERE project_id = ?
        AND velocity_score > ? * 2
      ORDER BY velocity_score DESC
      LIMIT 10
    `, [projectId, avgVelocity]);

    return anomalies.map((a) => ({
      ...a,
      anomaly: `Velocity ${a.velocity_score.toFixed(2)} is ${(a.velocity_score / avgVelocity).toFixed(1)}x above average`,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleTemporalCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "velocity": {
      const file = args[1];
      if (file) {
        const v = await calculateVelocity(db, projectId, file);
        console.error(`Velocity for ${file}: ${v.toFixed(3)}`);
        outputSuccess({ file, velocity: v });
      } else {
        // Show top velocity files
        try {
          const top = await db.all<{ path: string; velocity_score: number; change_count: number }>(`
            SELECT path, COALESCE(velocity_score, 0) as velocity_score, COALESCE(change_count, 0) as change_count
            FROM files WHERE project_id = ? AND velocity_score > 0
            ORDER BY velocity_score DESC LIMIT 10
          `, [projectId]);

          if (top.length === 0) {
            console.error("No velocity data yet. End sessions to build velocity scores.");
          } else {
            console.error("\n🚀 Top Velocity Files:\n");
            for (const f of top) {
              console.error(`  ${f.path} — ${f.velocity_score.toFixed(3)} (${f.change_count} changes)`);
            }
          }
          console.error("");
          outputJson(top);
        } catch {
          console.error("Velocity columns not yet available. Run migrations.");
        }
      }
      break;
    }

    case "anomalies": {
      const anomalies = await detectAnomalies(db, projectId);
      if (anomalies.length === 0) {
        console.error("No velocity anomalies detected.");
      } else {
        console.error(`\n⚠️  Velocity Anomalies (${anomalies.length}):\n`);
        for (const a of anomalies) {
          console.error(`  ${a.path}: ${a.anomaly}`);
        }
      }
      console.error("");
      outputJson(anomalies);
      break;
    }

    default:
      console.error("Usage: muninn temporal <velocity [file]|anomalies>");
  }
}
