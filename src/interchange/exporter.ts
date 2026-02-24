/**
 * Memory Interchange Exporter — v7 Phase 6C
 *
 * Exports project memory in a portable JSON format.
 * "The SQLite of agent memory" — any agent can import this.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface MuninnExport {
  version: "1.0";
  exportedAt: string;
  project: {
    name: string;
    type: string | null;
    stack: string[];
  };
  codebaseDNA: string | null;
  learnings: Array<{
    title: string;
    content: string;
    category: string;
    confidence: number;
  }>;
  decisions: Array<{
    title: string;
    decision: string;
    reasoning: string;
    outcome: string;
  }>;
  strategies: Array<{
    name: string;
    description: string;
    successRate: number;
    timesUsed: number;
  }>;
  files: Array<{
    path: string;
    purpose: string | null;
    fragility: number;
    type: string | null;
  }>;
  issues: Array<{
    title: string;
    severity: number;
    type: string | null;
    status: string;
  }>;
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export all project memory in interchange format.
 */
export async function exportMemory(
  db: DatabaseAdapter,
  projectId: number,
): Promise<MuninnExport> {
  const [project, dna, learnings, decisions, strategies, files, issues] = await Promise.all([
    exportProject(db, projectId),
    exportDNA(db, projectId),
    exportLearnings(db, projectId),
    exportDecisions(db, projectId),
    exportStrategies(db, projectId),
    exportFiles(db, projectId),
    exportIssues(db, projectId),
  ]);

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    project,
    codebaseDNA: dna,
    learnings,
    decisions,
    strategies,
    files,
    issues,
  };
}

// ============================================================================
// Section Exporters
// ============================================================================

async function exportProject(
  db: DatabaseAdapter,
  projectId: number,
): Promise<MuninnExport["project"]> {
  try {
    const row = await db.get<{ name: string; project_type: string | null }>(
      `SELECT name, project_type FROM projects WHERE id = ?`,
      [projectId],
    );

    // Get stack from developer profile
    let stack: string[] = [];
    try {
      const profile = await db.get<{ stack_technologies: string | null }>(
        `SELECT stack_technologies FROM developer_profile WHERE project_id = ?`,
        [projectId],
      );
      if (profile?.stack_technologies) {
        try { stack = JSON.parse(profile.stack_technologies); } catch { /* skip */ }
      }
    } catch { /* table may not exist */ }

    return {
      name: row?.name ?? "unknown",
      type: row?.project_type ?? null,
      stack,
    };
  } catch {
    return { name: "unknown", type: null, stack: [] };
  }
}

async function exportDNA(
  db: DatabaseAdapter,
  projectId: number,
): Promise<string | null> {
  try {
    const row = await db.get<{ formatted_text: string }>(
      `SELECT formatted_text FROM codebase_dna WHERE project_id = ?`,
      [projectId],
    );
    return row?.formatted_text ?? null;
  } catch {
    return null;
  }
}

async function exportLearnings(
  db: DatabaseAdapter,
  projectId: number,
): Promise<MuninnExport["learnings"]> {
  try {
    const rows = await db.all<{
      title: string;
      content: string;
      category: string;
      confidence: number;
    }>(
      `SELECT title, content, category, confidence FROM learnings
       WHERE project_id = ? AND archived_at IS NULL AND confidence >= 5
       ORDER BY confidence DESC LIMIT 100`,
      [projectId],
    );
    return rows;
  } catch {
    return [];
  }
}

async function exportDecisions(
  db: DatabaseAdapter,
  projectId: number,
): Promise<MuninnExport["decisions"]> {
  try {
    const rows = await db.all<{
      title: string;
      decision: string;
      reasoning: string;
      outcome: string;
    }>(
      `SELECT title, decision, reasoning, COALESCE(outcome, 'pending') as outcome
       FROM decisions WHERE project_id = ? AND archived_at IS NULL
       ORDER BY created_at DESC LIMIT 100`,
      [projectId],
    );
    return rows;
  } catch {
    return [];
  }
}

async function exportStrategies(
  db: DatabaseAdapter,
  projectId: number,
): Promise<MuninnExport["strategies"]> {
  try {
    const rows = await db.all<{
      name: string;
      description: string;
      success_rate: number;
      times_used: number;
    }>(
      `SELECT name, description, success_rate, times_used FROM strategy_catalog
       WHERE project_id = ? AND status = 'active'
       ORDER BY success_rate DESC LIMIT 50`,
      [projectId],
    );
    return rows.map((r) => ({
      name: r.name,
      description: r.description,
      successRate: r.success_rate,
      timesUsed: r.times_used,
    }));
  } catch {
    return [];
  }
}

async function exportFiles(
  db: DatabaseAdapter,
  projectId: number,
): Promise<MuninnExport["files"]> {
  try {
    const rows = await db.all<{
      path: string;
      purpose: string | null;
      fragility: number;
      type: string | null;
    }>(
      `SELECT path, purpose, fragility, type FROM files
       WHERE project_id = ? AND archived_at IS NULL
       ORDER BY fragility DESC, path ASC LIMIT 200`,
      [projectId],
    );
    return rows;
  } catch {
    return [];
  }
}

async function exportIssues(
  db: DatabaseAdapter,
  projectId: number,
): Promise<MuninnExport["issues"]> {
  try {
    const rows = await db.all<{
      title: string;
      severity: number;
      type: string | null;
      status: string;
    }>(
      `SELECT title, severity, type, status FROM issues
       WHERE project_id = ? AND status = 'open'
       ORDER BY severity DESC LIMIT 50`,
      [projectId],
    );
    return rows;
  } catch {
    return [];
  }
}
