/**
 * Predictive Context
 * Bundles all relevant context for a task in a single call.
 * Aggregates co-changers, dependencies, decisions, issues, learnings,
 * workflows, and profile entries.
 */

import type { Database } from "bun:sqlite";
import { outputJson } from "../utils/format";
import type { PredictionBundle } from "../types";
import { getCorrelatedFiles } from "./session";
import { getTopProfileEntries } from "./profile";

// ============================================================================
// Predictive Context
// ============================================================================

export function predictContext(
  db: Database,
  projectId: number,
  options: { task?: string; files?: string[] }
): PredictionBundle {
  const bundle: PredictionBundle = {
    relatedFiles: [],
    cochangingFiles: [],
    relevantDecisions: [],
    openIssues: [],
    applicableLearnings: [],
    workflowPattern: null,
    profileEntries: [],
    lastSessionContext: null,
    testFiles: [],
  };

  // 1. Co-changing files from correlations
  if (options.files && options.files.length > 0) {
    bundle.cochangingFiles = getCochangingFiles(db, projectId, options.files);
  }

  // 2. Blast radius dependents for given files
  if (options.files && options.files.length > 0) {
    bundle.relatedFiles = getBlastDependents(db, projectId, options.files);
  }

  // 3. Search for task-relevant context
  if (options.task) {
    const taskResults = searchForTask(db, projectId, options.task);
    bundle.relevantDecisions = taskResults.decisions;
    bundle.openIssues = taskResults.issues;
    bundle.applicableLearnings = taskResults.learnings;

    // Also find related files by task keyword
    if (bundle.relatedFiles.length === 0) {
      bundle.relatedFiles = searchRelatedFiles(db, projectId, options.task);
    }
  }

  // 4. Get open issues for involved files
  if (options.files && options.files.length > 0 && bundle.openIssues.length === 0) {
    bundle.openIssues = getIssuesForFiles(db, projectId, options.files);
  }

  // 5. Get applicable workflow pattern
  bundle.workflowPattern = getApplicableWorkflow(db, projectId, options.task);

  // 6. Get top profile entries
  bundle.profileEntries = getTopProfileEntries(db, projectId, 5);

  // 7. Get last session context from relationship graph
  bundle.lastSessionContext = getLastSessionContext(db, projectId);

  // 8. Get test files for input files
  if (options.files && options.files.length > 0) {
    bundle.testFiles = getTestFilesForSources(db, projectId, options.files);
  }

  return bundle;
}

// ============================================================================
// Helpers
// ============================================================================

function getCochangingFiles(
  db: Database,
  projectId: number,
  files: string[]
): Array<{ path: string; cochange_count: number }> {
  const seen = new Set(files);
  const results: Array<{ path: string; cochange_count: number }> = [];

  for (const file of files) {
    const correlated = getCorrelatedFiles(db, projectId, file, 3);
    for (const c of correlated) {
      if (!seen.has(c.file)) {
        seen.add(c.file);
        results.push({ path: c.file, cochange_count: c.cochange_count });
      }
    }
  }

  return results.sort((a, b) => b.cochange_count - a.cochange_count).slice(0, 10);
}

function getBlastDependents(
  db: Database,
  projectId: number,
  files: string[]
): Array<{ path: string; reason: string; confidence: number }> {
  const results: Array<{ path: string; reason: string; confidence: number }> = [];
  const seen = new Set(files);

  for (const file of files) {
    try {
      const dependents = db.query<{ affected_file: string; distance: number }, [number, string]>(`
        SELECT affected_file, distance FROM blast_radius
        WHERE project_id = ? AND source_file = ?
        ORDER BY distance ASC
        LIMIT 5
      `).all(projectId, file);

      for (const d of dependents) {
        if (!seen.has(d.affected_file)) {
          seen.add(d.affected_file);
          const confidence = Math.max(0.3, 1.0 - (d.distance * 0.2));
          results.push({
            path: d.affected_file,
            reason: `Depends on ${file} (distance: ${d.distance})`,
            confidence,
          });
        }
      }
    } catch {
      // blast_radius table might not exist
    }
  }

  return results.slice(0, 10);
}

function searchForTask(
  db: Database,
  projectId: number,
  task: string
): {
  decisions: Array<{ id: number; title: string }>;
  issues: Array<{ id: number; title: string; severity: number }>;
  learnings: Array<{ id: number; title: string; content: string }>;
} {
  const result = {
    decisions: [] as Array<{ id: number; title: string }>,
    issues: [] as Array<{ id: number; title: string; severity: number }>,
    learnings: [] as Array<{ id: number; title: string; content: string }>,
  };

  // Search decisions via FTS
  try {
    result.decisions = db.query<{ id: number; title: string }, [string, number]>(`
      SELECT d.id, d.title FROM fts_decisions
      JOIN decisions d ON fts_decisions.rowid = d.id
      WHERE fts_decisions MATCH ?1 AND d.project_id = ?2 AND d.status = 'active'
      ORDER BY bm25(fts_decisions)
      LIMIT 5
    `).all(task, projectId);
  } catch { /* FTS might fail */ }

  // Search issues
  try {
    result.issues = db.query<{ id: number; title: string; severity: number }, [string, number]>(`
      SELECT i.id, i.title, i.severity FROM fts_issues
      JOIN issues i ON fts_issues.rowid = i.id
      WHERE fts_issues MATCH ?1 AND i.project_id = ?2 AND i.status = 'open'
      ORDER BY i.severity DESC
      LIMIT 5
    `).all(task, projectId);
  } catch { /* FTS might fail */ }

  // Search learnings
  try {
    result.learnings = db.query<{ id: number; title: string; content: string }, [string, number]>(`
      SELECT l.id, l.title, l.content FROM fts_learnings
      JOIN learnings l ON fts_learnings.rowid = l.id
      WHERE fts_learnings MATCH ?1 AND (l.project_id = ?2 OR l.project_id IS NULL)
      ORDER BY bm25(fts_learnings)
      LIMIT 5
    `).all(task, projectId);
  } catch { /* FTS might fail */ }

  return result;
}

function searchRelatedFiles(
  db: Database,
  projectId: number,
  task: string
): Array<{ path: string; reason: string; confidence: number }> {
  try {
    const files = db.query<{ path: string; purpose: string | null }, [string, number]>(`
      SELECT f.path, f.purpose FROM fts_files
      JOIN files f ON fts_files.rowid = f.id
      WHERE fts_files MATCH ?1 AND f.project_id = ?2
      ORDER BY bm25(fts_files)
      LIMIT 5
    `).all(task, projectId);

    return files.map((f, i) => ({
      path: f.path,
      reason: f.purpose?.slice(0, 60) ?? 'Related to task',
      confidence: Math.max(0.3, 0.9 - (i * 0.15)),
    }));
  } catch {
    return [];
  }
}

function getIssuesForFiles(
  db: Database,
  projectId: number,
  files: string[]
): Array<{ id: number; title: string; severity: number }> {
  try {
    const results: Array<{ id: number; title: string; severity: number }> = [];
    const seen = new Set<number>();

    for (const file of files) {
      const issues = db.query<{ id: number; title: string; severity: number }, [number, string]>(`
        SELECT id, title, severity FROM issues
        WHERE project_id = ? AND status = 'open'
          AND affected_files LIKE '%' || ? || '%'
        ORDER BY severity DESC
        LIMIT 3
      `).all(projectId, file);

      for (const issue of issues) {
        if (!seen.has(issue.id)) {
          seen.add(issue.id);
          results.push(issue);
        }
      }
    }

    return results.sort((a, b) => b.severity - a.severity).slice(0, 5);
  } catch {
    return [];
  }
}

function getApplicableWorkflow(
  db: Database,
  projectId: number,
  task?: string
): { task_type: string; approach: string } | null {
  if (!task) return null;

  // Heuristic: match task description to workflow types
  const taskLower = task.toLowerCase();
  let taskType: string | null = null;

  if (taskLower.includes('review') || taskLower.includes('pr')) {
    taskType = 'code_review';
  } else if (taskLower.includes('bug') || taskLower.includes('fix') || taskLower.includes('debug')) {
    taskType = 'debugging';
  } else if (taskLower.includes('feature') || taskLower.includes('add') || taskLower.includes('implement')) {
    taskType = 'feature_build';
  } else if (taskLower.includes('refactor') || taskLower.includes('clean')) {
    taskType = 'refactor';
  } else if (taskLower.includes('research') || taskLower.includes('investigate')) {
    taskType = 'research';
  }

  if (!taskType) return null;

  try {
    const workflow = db.query<{ task_type: string; approach: string }, [number, string]>(`
      SELECT task_type, approach FROM workflow_patterns
      WHERE (project_id = ? OR project_id IS NULL) AND task_type = ?
      ORDER BY project_id DESC
      LIMIT 1
    `).all(projectId, taskType);

    return workflow[0] ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Session Context from Relationship Graph
// ============================================================================

/**
 * Get context from the last session using relationship graph
 * Uses "made", "found", "resolved", "learned" relationship types
 */
function getLastSessionContext(
  db: Database,
  projectId: number
): PredictionBundle['lastSessionContext'] {
  try {
    // Get last completed session
    const lastSession = db.query<{ id: number; goal: string | null }, [number]>(`
      SELECT id, goal FROM sessions
      WHERE project_id = ? AND ended_at IS NOT NULL
      ORDER BY ended_at DESC
      LIMIT 1
    `).get(projectId);

    if (!lastSession) return null;

    const sessionId = lastSession.id;

    // Get decisions made during session (via "made" relationship)
    const decisionsMade = db.query<{ id: number; title: string }, [number]>(`
      SELECT d.id, d.title FROM relationships r
      JOIN decisions d ON r.target_id = d.id AND r.target_type = 'decision'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'made'
      ORDER BY r.strength DESC
    `).all(sessionId);

    // Get issues found during session (via "found" relationship)
    const issuesFound = db.query<{ id: number; title: string }, [number]>(`
      SELECT i.id, i.title FROM relationships r
      JOIN issues i ON r.target_id = i.id AND r.target_type = 'issue'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'found'
      ORDER BY r.strength DESC
    `).all(sessionId);

    // Get issues resolved during session (via "resolved" relationship)
    const issuesResolved = db.query<{ id: number; title: string }, [number]>(`
      SELECT i.id, i.title FROM relationships r
      JOIN issues i ON r.target_id = i.id AND r.target_type = 'issue'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'resolved'
      ORDER BY r.strength DESC
    `).all(sessionId);

    // Get learnings extracted from session (via "learned" relationship)
    const learningsExtracted = db.query<{ id: number; title: string }, [number]>(`
      SELECT l.id, l.title FROM relationships r
      JOIN learnings l ON r.target_id = l.id AND r.target_type = 'learning'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'learned'
      ORDER BY r.strength DESC
    `).all(sessionId);

    return {
      sessionId,
      goal: lastSession.goal,
      decisionsMade,
      issuesFound,
      issuesResolved,
      learningsExtracted,
    };
  } catch {
    return null;
  }
}

/**
 * Get test files that cover the given source files
 * Uses "tests" relationship type
 */
function getTestFilesForSources(
  db: Database,
  projectId: number,
  files: string[]
): Array<{ testPath: string; sourcePath: string }> {
  const results: Array<{ testPath: string; sourcePath: string }> = [];

  for (const sourcePath of files) {
    try {
      // Find file ID for source
      const sourceFile = db.query<{ id: number }, [number, string]>(
        "SELECT id FROM files WHERE project_id = ? AND path = ?"
      ).get(projectId, sourcePath);

      if (!sourceFile) continue;

      // Find test files via "tests" relationship (test → source)
      const testFiles = db.query<{ path: string }, [number]>(`
        SELECT f.path FROM relationships r
        JOIN files f ON r.source_id = f.id AND r.source_type = 'file'
        WHERE r.target_type = 'file' AND r.target_id = ?
          AND r.relationship = 'tests'
      `).all(sourceFile.id);

      for (const { path } of testFiles) {
        results.push({ testPath: path, sourcePath });
      }
    } catch {
      // Skip on error
    }
  }

  return results;
}

// ============================================================================
// CLI Handler
// ============================================================================

export function handlePredictCommand(db: Database, projectId: number, args: string[]): void {
  const taskParts: string[] = [];
  const files: string[] = [];
  let mode: 'task' | 'files' = 'task';

  for (const arg of args) {
    if (arg === '--files') {
      mode = 'files';
      continue;
    }
    if (mode === 'files') {
      files.push(arg);
    } else {
      taskParts.push(arg);
    }
  }

  const task = taskParts.join(' ') || undefined;

  if (!task && files.length === 0) {
    console.error("Usage: muninn predict <task description> [--files file1 file2 ...]");
    return;
  }

  const bundle = predictContext(db, projectId, { task, files });

  console.error("\n🔮 Predictive Context Bundle:\n");

  if (bundle.relatedFiles.length > 0) {
    console.error("  📁 Related Files:");
    for (const f of bundle.relatedFiles) {
      console.error(`     ${f.path} — ${f.reason}`);
    }
    console.error("");
  }

  if (bundle.cochangingFiles.length > 0) {
    console.error("  🔗 Co-changing Files:");
    for (const f of bundle.cochangingFiles) {
      console.error(`     ${f.path} (${f.cochange_count}x together)`);
    }
    console.error("");
  }

  if (bundle.relevantDecisions.length > 0) {
    console.error("  📋 Relevant Decisions:");
    for (const d of bundle.relevantDecisions) {
      console.error(`     #${d.id}: ${d.title}`);
    }
    console.error("");
  }

  if (bundle.openIssues.length > 0) {
    console.error("  ⚠️  Open Issues:");
    for (const i of bundle.openIssues) {
      console.error(`     #${i.id} [sev ${i.severity}]: ${i.title}`);
    }
    console.error("");
  }

  if (bundle.applicableLearnings.length > 0) {
    console.error("  💡 Applicable Learnings:");
    for (const l of bundle.applicableLearnings) {
      console.error(`     ${l.title}: ${l.content.slice(0, 60)}`);
    }
    console.error("");
  }

  if (bundle.workflowPattern) {
    console.error(`  🔄 Workflow: ${bundle.workflowPattern.task_type}`);
    console.error(`     ${bundle.workflowPattern.approach.slice(0, 80)}`);
    console.error("");
  }

  if (bundle.profileEntries.length > 0) {
    console.error("  👤 Profile Hints:");
    for (const p of bundle.profileEntries) {
      console.error(`     [${p.category}] ${p.key}: ${p.value.slice(0, 50)}`);
    }
    console.error("");
  }

  // New: Last session context from relationship graph
  if (bundle.lastSessionContext) {
    const ctx = bundle.lastSessionContext;
    console.error(`  📍 Last Session (#${ctx.sessionId}):`);
    if (ctx.goal) {
      console.error(`     Goal: ${ctx.goal.slice(0, 60)}`);
    }
    if (ctx.decisionsMade.length > 0) {
      console.error(`     Decisions made: ${ctx.decisionsMade.map(d => `D${d.id}`).join(', ')}`);
    }
    if (ctx.issuesFound.length > 0) {
      console.error(`     Issues found: ${ctx.issuesFound.map(i => `#${i.id}`).join(', ')}`);
    }
    if (ctx.issuesResolved.length > 0) {
      console.error(`     Issues resolved: ${ctx.issuesResolved.map(i => `#${i.id}`).join(', ')}`);
    }
    if (ctx.learningsExtracted.length > 0) {
      console.error(`     Learnings: ${ctx.learningsExtracted.map(l => l.title.slice(0, 30)).join(', ')}`);
    }
    console.error("");
  }

  // New: Test files for input files
  if (bundle.testFiles.length > 0) {
    console.error("  🧪 Test Coverage:");
    for (const t of bundle.testFiles) {
      console.error(`     ${t.testPath} → ${t.sourcePath}`);
    }
    console.error("");
  }

  outputJson(bundle);
}
