/**
 * Temporal Intelligence
 * Applies time-aware scoring to search results, tracks file velocity,
 * and detects anomalous change patterns.
 */

import type { Database } from "bun:sqlite";
import type { QueryResult } from "../types";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Temporal Scoring
// ============================================================================

/**
 * Re-rank results by recency + frequency + velocity.
 * Applied after focus boost in the search pipeline.
 */
export function applyTemporalScoring(
  results: QueryResult[],
  db: Database,
  projectId: number
): QueryResult[] {
  if (results.length === 0) return results;

  return results.map(r => {
    let temporalBoost = 0;

    if (r.type === 'file') {
      const fileInfo = getFileTemporalInfo(db, projectId, r.title);
      if (fileInfo) {
        // Velocity boost: faster-changing files are more relevant now
        temporalBoost += Math.min(0.3, fileInfo.velocity_score * 0.1);
        // Recency boost: recently changed files
        if (fileInfo.temperature === 'hot') temporalBoost += 0.2;
        else if (fileInfo.temperature === 'warm') temporalBoost += 0.1;
      }
    }

    // For decisions/learnings, hot items get boosted
    if (['decision', 'learning', 'issue'].includes(r.type)) {
      const tempInfo = getEntityTemperature(db, r.type, r.id);
      if (tempInfo === 'hot') temporalBoost += 0.2;
      else if (tempInfo === 'warm') temporalBoost += 0.1;
    }

    // Lower relevance = better for bm25 scores
    return { ...r, relevance: r.relevance - temporalBoost };
  }).sort((a, b) => a.relevance - b.relevance);
}

function getFileTemporalInfo(
  db: Database,
  projectId: number,
  filePath: string
): { velocity_score: number; temperature: string } | null {
  try {
    return db.query<{ velocity_score: number; temperature: string }, [number, string]>(`
      SELECT COALESCE(velocity_score, 0) as velocity_score, COALESCE(temperature, 'cold') as temperature
      FROM files WHERE project_id = ? AND path = ?
    `).get(projectId, filePath) ?? null;
  } catch {
    return null;
  }
}

function getEntityTemperature(db: Database, type: string, id: number): string | null {
  const tableMap: Record<string, string> = {
    decision: 'decisions',
    learning: 'learnings',
    issue: 'issues',
    file: 'files',
  };
  const table = tableMap[type];
  if (!table) return null;

  try {
    const result = db.query<{ temperature: string }, [number]>(
      `SELECT COALESCE(temperature, 'cold') as temperature FROM ${table} WHERE id = ?`
    ).get(id);
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
export function calculateVelocity(
  db: Database,
  projectId: number,
  filePath: string
): number {
  try {
    const fileInfo = db.query<{ change_count: number; first_changed_at: string | null }, [number, string]>(`
      SELECT COALESCE(change_count, 0) as change_count, first_changed_at
      FROM files WHERE project_id = ? AND path = ?
    `).get(projectId, filePath);

    if (!fileInfo || fileInfo.change_count === 0) return 0;

    // Get total sessions since first change
    const sessionCount = db.query<{ count: number }, [number, string]>(`
      SELECT COUNT(*) as count FROM sessions
      WHERE project_id = ?
        AND started_at >= COALESCE(?, '2000-01-01')
    `).get(projectId, fileInfo.first_changed_at ?? '2000-01-01');

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
export function updateFileVelocity(
  db: Database,
  projectId: number,
  files: string[]
): void {
  for (const filePath of files) {
    try {
      db.run(`
        UPDATE files SET
          change_count = COALESCE(change_count, 0) + 1,
          first_changed_at = COALESCE(first_changed_at, CURRENT_TIMESTAMP),
          velocity_score = CAST(COALESCE(change_count, 0) + 1 AS REAL) /
            MAX(1, (SELECT COUNT(*) FROM sessions WHERE project_id = ?
                    AND started_at >= COALESCE(files.first_changed_at, '2000-01-01')))
        WHERE project_id = ? AND path = ?
      `, [projectId, projectId, filePath]);
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
export function assignSessionNumber(
  db: Database,
  projectId: number,
  sessionId: number
): number {
  try {
    const maxNum = db.query<{ max_num: number | null }, [number]>(`
      SELECT MAX(session_number) as max_num FROM sessions WHERE project_id = ?
    `).get(projectId);

    const nextNum = (maxNum?.max_num ?? 0) + 1;

    db.run(`
      UPDATE sessions SET session_number = ? WHERE id = ?
    `, [nextNum, sessionId]);

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
export function detectAnomalies(
  db: Database,
  projectId: number
): Array<{ path: string; velocity_score: number; change_count: number; anomaly: string }> {
  try {
    // Get average velocity across all files
    const avg = db.query<{ avg_velocity: number }, [number]>(`
      SELECT AVG(COALESCE(velocity_score, 0)) as avg_velocity FROM files
      WHERE project_id = ? AND velocity_score > 0
    `).get(projectId);

    const avgVelocity = avg?.avg_velocity ?? 0;
    if (avgVelocity === 0) return [];

    // Find files with velocity > 2x average
    const anomalies = db.query<{
      path: string; velocity_score: number; change_count: number;
    }, [number, number]>(`
      SELECT path, velocity_score, change_count FROM files
      WHERE project_id = ?
        AND velocity_score > ? * 2
      ORDER BY velocity_score DESC
      LIMIT 10
    `).all(projectId, avgVelocity);

    return anomalies.map(a => ({
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

export function handleTemporalCommand(db: Database, projectId: number, args: string[]): void {
  const subCmd = args[0];

  switch (subCmd) {
    case "velocity": {
      const file = args[1];
      if (file) {
        const v = calculateVelocity(db, projectId, file);
        console.error(`Velocity for ${file}: ${v.toFixed(3)}`);
        outputSuccess({ file, velocity: v });
      } else {
        // Show top velocity files
        try {
          const top = db.query<{ path: string; velocity_score: number; change_count: number }, [number]>(`
            SELECT path, COALESCE(velocity_score, 0) as velocity_score, COALESCE(change_count, 0) as change_count
            FROM files WHERE project_id = ? AND velocity_score > 0
            ORDER BY velocity_score DESC LIMIT 10
          `).all(projectId);

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
      const anomalies = detectAnomalies(db, projectId);
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
      console.error("Usage: context temporal <velocity [file]|anomalies>");
  }
}
