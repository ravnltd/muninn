/**
 * Temperature System
 * Track entity heat (hot/warm/cold) based on recent reference patterns
 */

import type { DatabaseAdapter } from "../database/adapter";

/**
 * Decay temperature based on session count since last reference.
 * Called on session start.
 * Hot = referenced in last 3 sessions, Warm = 3-10, Cold = 10+
 */
export async function decayTemperatures(db: DatabaseAdapter, projectId: number): Promise<void> {
  const tables = ["files", "decisions", "issues", "learnings"];

  for (const table of tables) {
    try {
      // Set cold: last_referenced_at more than 10 sessions ago or null
      await db.run(
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
      await db.run(
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
export async function heatEntity(db: DatabaseAdapter, table: string, id: number): Promise<void> {
  try {
    await db.run(
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
export async function getHotEntities(
  db: DatabaseAdapter,
  projectId: number
): Promise<{
  files: Array<{ path: string; purpose: string | null }>;
  decisions: Array<{ id: number; title: string }>;
  learnings: Array<{ id: number; title: string }>;
}> {
  const result = {
    files: [] as Array<{ path: string; purpose: string | null }>,
    decisions: [] as Array<{ id: number; title: string }>,
    learnings: [] as Array<{ id: number; title: string }>,
  };

  try {
    result.files = await db.all<{ path: string; purpose: string | null }>(
      `SELECT path, purpose FROM files
      WHERE project_id = ? AND temperature = 'hot'
      ORDER BY last_referenced_at DESC LIMIT 5`,
      [projectId]
    );
  } catch {
    /* temperature column may not exist */
  }

  try {
    result.decisions = await db.all<{ id: number; title: string }>(
      `SELECT id, title FROM decisions
      WHERE project_id = ? AND temperature = 'hot' AND status = 'active'
      ORDER BY last_referenced_at DESC LIMIT 5`,
      [projectId]
    );
  } catch {
    /* temperature column may not exist */
  }

  try {
    result.learnings = await db.all<{ id: number; title: string }>(
      `SELECT id, title FROM learnings
      WHERE (project_id = ? OR project_id IS NULL) AND temperature = 'hot'
      ORDER BY last_referenced_at DESC LIMIT 5`,
      [projectId]
    );
  } catch {
    /* temperature column may not exist */
  }

  return result;
}

/**
 * Get recent observations for resume
 */
export async function getRecentObservations(
  db: DatabaseAdapter,
  projectId: number,
  limit: number = 3
): Promise<Array<{
  type: string;
  content: string;
  frequency: number;
}>> {
  try {
    return await db.all<{ type: string; content: string; frequency: number }>(
      `SELECT type, content, frequency FROM observations
      WHERE (project_id = ? OR project_id IS NULL)
      ORDER BY last_seen_at DESC
      LIMIT ?`,
      [projectId, limit]
    );
  } catch {
    return [];
  }
}
