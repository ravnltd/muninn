/**
 * Intelligent Forgetting — Knowledge Archiver
 *
 * Archives stale, low-confidence, or superseded knowledge items.
 * Archived items are preserved in archived_knowledge but removed
 * from active queries, keeping the context window lean.
 *
 * Archive criteria:
 *   - Learnings with confidence < 3 and age > 60 days
 *   - Decisions with outcome = 'failed' and age > 90 days
 *   - Issues resolved > 90 days ago
 *   - Learnings not reinforced in 90+ days with confidence < 5
 */

import type { DatabaseAdapter } from "../database/adapter";

interface ArchiveResult {
  archivedLearnings: number;
  archivedDecisions: number;
  archivedIssues: number;
  totalArchived: number;
}

interface ExportedMemory {
  exportedAt: string;
  projectId: number;
  files: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  learnings: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  archived: Array<Record<string, unknown>>;
}

/** Archive stale knowledge items for a project */
export async function archiveStaleKnowledge(
  db: DatabaseAdapter,
  projectId: number,
): Promise<ArchiveResult> {
  let archivedLearnings = 0;
  let archivedDecisions = 0;
  let archivedIssues = 0;

  // 1. Archive low-confidence old learnings
  try {
    const staleLearnings = await db.all<{
      id: number;
      title: string;
      content: string;
      confidence: number;
    }>(
      `SELECT id, title, content, confidence FROM learnings
       WHERE project_id = ? AND archived_at IS NULL
       AND confidence < 3 AND created_at < datetime('now', '-60 days')`,
      [projectId],
    );

    for (const learning of staleLearnings) {
      await db.run(
        `INSERT INTO archived_knowledge (project_id, source_table, source_id, title, content, reason)
         VALUES (?, 'learnings', ?, ?, ?, ?)`,
        [projectId, learning.id, learning.title, learning.content,
         `Low confidence ${learning.confidence} and older than 60 days`],
      );
      await db.run(
        `UPDATE learnings SET archived_at = datetime('now') WHERE id = ?`,
        [learning.id],
      );
      archivedLearnings++;
    }
  } catch {
    // archived_at column may not exist
  }

  // 2. Archive unreinforced learnings
  try {
    const unreinforced = await db.all<{
      id: number;
      title: string;
      content: string;
      confidence: number;
    }>(
      `SELECT id, title, content, confidence FROM learnings
       WHERE project_id = ? AND archived_at IS NULL
       AND confidence < 5 AND auto_reinforcement_count = 0
       AND updated_at < datetime('now', '-90 days')`,
      [projectId],
    );

    for (const learning of unreinforced) {
      await db.run(
        `INSERT INTO archived_knowledge (project_id, source_table, source_id, title, content, reason)
         VALUES (?, 'learnings', ?, ?, ?, ?)`,
        [projectId, learning.id, learning.title, learning.content,
         `Never reinforced, confidence ${learning.confidence}, stale 90+ days`],
      );
      await db.run(
        `UPDATE learnings SET archived_at = datetime('now') WHERE id = ?`,
        [learning.id],
      );
      archivedLearnings++;
    }
  } catch {
    // auto_reinforcement_count may not exist
  }

  // 3. Archive old failed decisions
  try {
    const failedDecisions = await db.all<{
      id: number;
      title: string;
      decision: string;
    }>(
      `SELECT id, title, decision FROM decisions
       WHERE project_id = ? AND archived_at IS NULL
       AND outcome = 'failed' AND updated_at < datetime('now', '-90 days')`,
      [projectId],
    );

    for (const decision of failedDecisions) {
      await db.run(
        `INSERT INTO archived_knowledge (project_id, source_table, source_id, title, content, reason)
         VALUES (?, 'decisions', ?, ?, ?, ?)`,
        [projectId, decision.id, decision.title, decision.decision,
         'Failed decision older than 90 days'],
      );
      await db.run(
        `UPDATE decisions SET archived_at = datetime('now') WHERE id = ?`,
        [decision.id],
      );
      archivedDecisions++;
    }
  } catch {
    // archived_at column may not exist
  }

  // 4. Archive old resolved issues
  try {
    const resolvedIssues = await db.all<{
      id: number;
      title: string;
      description: string | null;
    }>(
      `SELECT id, title, description FROM issues
       WHERE project_id = ? AND status = 'resolved'
       AND updated_at < datetime('now', '-90 days')`,
      [projectId],
    );

    for (const issue of resolvedIssues) {
      await db.run(
        `INSERT INTO archived_knowledge (project_id, source_table, source_id, title, content, reason)
         VALUES (?, 'issues', ?, ?, ?, ?)`,
        [projectId, issue.id, issue.title, issue.description,
         'Resolved issue older than 90 days'],
      );
      archivedIssues++;
    }
  } catch {
    // issues table structure may vary
  }

  return {
    archivedLearnings,
    archivedDecisions,
    archivedIssues,
    totalArchived: archivedLearnings + archivedDecisions + archivedIssues,
  };
}

/** Restore a previously archived item back to active status */
export async function restoreArchivedItem(
  db: DatabaseAdapter,
  projectId: number,
  archivedId: number,
): Promise<void> {
  const row = await db.get<{
    id: number;
    source_table: string;
    source_id: number;
  }>(
    `SELECT id, source_table, source_id FROM archived_knowledge
     WHERE id = ? AND project_id = ?`,
    [archivedId, projectId],
  );

  if (!row) {
    throw new Error("Archived item not found");
  }

  // Validate table name against whitelist to prevent SQL injection
  const RESTORABLE_TABLES = new Set(["learnings", "decisions"]);
  if (RESTORABLE_TABLES.has(row.source_table)) {
    const safeTable = row.source_table as "learnings" | "decisions";
    await db.run(
      `UPDATE ${safeTable} SET archived_at = NULL WHERE id = ?`,
      [row.source_id],
    );
  }

  await db.run(
    `DELETE FROM archived_knowledge WHERE id = ?`,
    [archivedId],
  );
}

/** Export all memory for a project (active + archived) */
export async function exportMemory(
  db: DatabaseAdapter,
  projectId: number,
): Promise<ExportedMemory> {
  const [files, decisions, learnings, issues, sessions, archived] = await Promise.all([
    db.all<Record<string, unknown>>(
      `SELECT * FROM files WHERE project_id = ? ORDER BY path`, [projectId],
    ),
    db.all<Record<string, unknown>>(
      `SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC`, [projectId],
    ),
    db.all<Record<string, unknown>>(
      `SELECT * FROM learnings WHERE project_id = ? ORDER BY created_at DESC`, [projectId],
    ),
    db.all<Record<string, unknown>>(
      `SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC`, [projectId],
    ),
    db.all<Record<string, unknown>>(
      `SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 100`, [projectId],
    ),
    db.all<Record<string, unknown>>(
      `SELECT * FROM archived_knowledge WHERE project_id = ? ORDER BY archived_at DESC`, [projectId],
    ).catch(() => [] as Array<Record<string, unknown>>),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    projectId,
    files,
    decisions,
    learnings,
    issues,
    sessions,
    archived,
  };
}
