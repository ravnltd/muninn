/**
 * Temperature System
 * Track entity heat (hot/warm/cold) based on recent reference patterns
 */

import type { Database } from "bun:sqlite";

/**
 * Decay temperature based on session count since last reference.
 * Called on session start.
 * Hot = referenced in last 3 sessions, Warm = 3-10, Cold = 10+
 */
export function decayTemperatures(db: Database, projectId: number): void {
  const tables = ["files", "decisions", "issues", "learnings"];

  for (const table of tables) {
    try {
      // Set cold: last_referenced_at more than 10 sessions ago or null
      db.run(
        `
        UPDATE ${table}
        SET temperature = 'cold'
        WHERE project_id = ? AND temperature != 'cold'
        AND (last_referenced_at IS NULL OR
             (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND started_at > last_referenced_at) > 10)
      `,
        [projectId, projectId]
      );

      // Set warm: last_referenced between 3-10 sessions ago
      db.run(
        `
        UPDATE ${table}
        SET temperature = 'warm'
        WHERE project_id = ? AND temperature = 'hot'
        AND last_referenced_at IS NOT NULL
        AND (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND started_at > last_referenced_at) BETWEEN 3 AND 10
      `,
        [projectId, projectId]
      );
    } catch {
      // Temperature columns might not exist yet
    }
  }
}

/**
 * Heat an entity when it's queried/referenced
 */
export function heatEntity(db: Database, table: string, id: number): void {
  try {
    db.run(
      `
      UPDATE ${table}
      SET temperature = 'hot', last_referenced_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [id]
    );
  } catch {
    // Temperature columns might not exist
  }
}

/**
 * Get hot entities for resume display
 */
export function getHotEntities(
  db: Database,
  projectId: number
): {
  files: Array<{ path: string; purpose: string | null }>;
  decisions: Array<{ id: number; title: string }>;
  learnings: Array<{ id: number; title: string }>;
} {
  const result = {
    files: [] as Array<{ path: string; purpose: string | null }>,
    decisions: [] as Array<{ id: number; title: string }>,
    learnings: [] as Array<{ id: number; title: string }>,
  };

  try {
    result.files = db
      .query<{ path: string; purpose: string | null }, [number]>(`
      SELECT path, purpose FROM files
      WHERE project_id = ? AND temperature = 'hot'
      ORDER BY last_referenced_at DESC LIMIT 5
    `)
      .all(projectId);
  } catch {
    /* temperature column may not exist */
  }

  try {
    result.decisions = db
      .query<{ id: number; title: string }, [number]>(`
      SELECT id, title FROM decisions
      WHERE project_id = ? AND temperature = 'hot' AND status = 'active'
      ORDER BY last_referenced_at DESC LIMIT 5
    `)
      .all(projectId);
  } catch {
    /* temperature column may not exist */
  }

  try {
    result.learnings = db
      .query<{ id: number; title: string }, [number]>(`
      SELECT id, title FROM learnings
      WHERE (project_id = ? OR project_id IS NULL) AND temperature = 'hot'
      ORDER BY last_referenced_at DESC LIMIT 5
    `)
      .all(projectId);
  } catch {
    /* temperature column may not exist */
  }

  return result;
}

/**
 * Get recent observations for resume
 */
export function getRecentObservations(
  db: Database,
  projectId: number,
  limit: number = 3
): Array<{
  type: string;
  content: string;
  frequency: number;
}> {
  try {
    return db
      .query<{ type: string; content: string; frequency: number }, [number, number]>(`
      SELECT type, content, frequency FROM observations
      WHERE (project_id = ? OR project_id IS NULL)
      ORDER BY last_seen_at DESC
      LIMIT ?
    `)
      .all(projectId, limit);
  } catch {
    return [];
  }
}
