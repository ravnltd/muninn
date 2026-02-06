/**
 * Shared Knowledge Aggregator — Surface high-confidence learnings to team
 *
 * Scans project learnings with confidence >= 7 and promotes to team_learnings.
 * Deduplicates by title similarity. Marks global learnings for cross-project use.
 *
 * Runs as background job — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface TeamLearning {
  title: string;
  content: string;
  category: string;
  contributor: string;
  confidence: number;
  sourceLearningId: number;
}

// ============================================================================
// Aggregation
// ============================================================================

/**
 * Scan project learnings and promote high-confidence ones to team learnings.
 * Deduplicates by checking existing team_learnings titles.
 */
export async function aggregateLearnings(
  db: DatabaseAdapter,
  projectId: number
): Promise<{ promoted: number; skipped: number }> {
  let promoted = 0;
  let skipped = 0;

  try {
    // Find high-confidence learnings not yet promoted
    const candidates = await db.all<{
      id: number;
      title: string;
      content: string;
      category: string;
      confidence: number;
    }>(
      `SELECT l.id, l.title, l.content, l.category, l.confidence
       FROM learnings l
       LEFT JOIN team_learnings tl ON tl.project_id = l.project_id AND tl.source_learning_id = l.id
       WHERE l.project_id = ? AND l.confidence >= 7 AND tl.id IS NULL
       ORDER BY l.confidence DESC
       LIMIT 20`,
      [projectId]
    );

    for (const candidate of candidates) {
      // Check for title similarity (exact match dedup)
      const existing = await db.get<{ id: number; times_confirmed: number }>(
        `SELECT id, times_confirmed FROM team_learnings
         WHERE project_id = ? AND title = ?`,
        [projectId, candidate.title]
      );

      if (existing) {
        // Increment confirmation count
        await db.run(
          `UPDATE team_learnings SET times_confirmed = times_confirmed + 1, confidence = MIN(10, confidence + 0.5)
           WHERE id = ?`,
          [existing.id]
        );
        skipped++;
        continue;
      }

      // Promote to team learning
      await db.run(
        `INSERT INTO team_learnings (project_id, source_learning_id, title, content, category, confidence, is_global)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          candidate.id,
          candidate.title,
          candidate.content,
          candidate.category || "general",
          candidate.confidence,
          candidate.category === "convention" || candidate.category === "gotcha" ? 1 : 0,
        ]
      );
      promoted++;
    }
  } catch {
    // Tables might not exist
  }

  return { promoted, skipped };
}

/**
 * Get team learnings relevant to a domain or file.
 */
export async function getTeamLearnings(
  db: DatabaseAdapter,
  projectId: number,
  domain?: string,
  limit: number = 10
): Promise<TeamLearning[]> {
  try {
    const query = domain
      ? `SELECT title, content, category, COALESCE(contributor, 'auto') as contributor, confidence, source_learning_id
         FROM team_learnings
         WHERE project_id = ? AND (category LIKE ? OR content LIKE ?)
         ORDER BY confidence DESC, times_confirmed DESC
         LIMIT ?`
      : `SELECT title, content, category, COALESCE(contributor, 'auto') as contributor, confidence, source_learning_id
         FROM team_learnings
         WHERE project_id = ?
         ORDER BY confidence DESC, times_confirmed DESC
         LIMIT ?`;

    const params = domain
      ? [projectId, `%${domain}%`, `%${domain}%`, limit]
      : [projectId, limit];

    const rows = await db.all<{
      title: string;
      content: string;
      category: string;
      contributor: string;
      confidence: number;
      source_learning_id: number;
    }>(query, params);

    return rows.map((r) => ({
      title: r.title,
      content: r.content,
      category: r.category,
      contributor: r.contributor,
      confidence: r.confidence,
      sourceLearningId: r.source_learning_id,
    }));
  } catch {
    return [];
  }
}

/**
 * Get global learnings (applicable across all projects).
 */
export async function getGlobalLearnings(
  db: DatabaseAdapter,
  projectId: number,
  limit: number = 5
): Promise<TeamLearning[]> {
  try {
    const rows = await db.all<{
      title: string;
      content: string;
      category: string;
      contributor: string;
      confidence: number;
      source_learning_id: number;
    }>(
      `SELECT title, content, category, COALESCE(contributor, 'auto') as contributor, confidence, source_learning_id
       FROM team_learnings
       WHERE project_id = ? AND is_global = 1
       ORDER BY confidence DESC
       LIMIT ?`,
      [projectId, limit]
    );

    return rows.map((r) => ({
      title: r.title,
      content: r.content,
      category: r.category,
      contributor: r.contributor,
      confidence: r.confidence,
      sourceLearningId: r.source_learning_id,
    }));
  } catch {
    return [];
  }
}
