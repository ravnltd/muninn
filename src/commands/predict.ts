/**
 * Predictive Context
 * Bundles all relevant context for a task in a single call.
 * Aggregates co-changers, dependencies, decisions, issues, learnings,
 * workflows, and profile entries.
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { OutcomeStatus, PredictionAdvisory, PredictionBundle } from "../types";
import { outputJson } from "../utils/format";
import { getTopProfileEntries } from "./profile";
import { getCorrelatedFiles } from "./session";

// ============================================================================
// Predictive Context
// ============================================================================

export async function predictContext(
  db: DatabaseAdapter,
  projectId: number,
  options: { task?: string; files?: string[]; advise?: boolean }
): Promise<PredictionBundle> {
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
    bundle.cochangingFiles = await getCochangingFiles(db, projectId, options.files);
  }

  // 2. Blast radius dependents for given files
  if (options.files && options.files.length > 0) {
    bundle.relatedFiles = await getBlastDependents(db, projectId, options.files);
  }

  // 3. Search for task-relevant context
  if (options.task) {
    const taskResults = await searchForTask(db, projectId, options.task);
    bundle.relevantDecisions = taskResults.decisions;
    bundle.openIssues = taskResults.issues;
    bundle.applicableLearnings = taskResults.learnings;

    // Also find related files by task keyword
    if (bundle.relatedFiles.length === 0) {
      bundle.relatedFiles = await searchRelatedFiles(db, projectId, options.task);
    }
  }

  // 4. Get open issues for involved files
  if (options.files && options.files.length > 0 && bundle.openIssues.length === 0) {
    bundle.openIssues = await getIssuesForFiles(db, projectId, options.files);
  }

  // 5. Get applicable workflow pattern
  bundle.workflowPattern = await getApplicableWorkflow(db, projectId, options.task);

  // 6. Get top profile entries
  bundle.profileEntries = await getTopProfileEntries(db, projectId, 5);

  // 7. Get last session context from relationship graph
  bundle.lastSessionContext = await getLastSessionContext(db, projectId);

  // 8. Get test files for input files
  if (options.files && options.files.length > 0) {
    bundle.testFiles = await getTestFilesForSources(db, projectId, options.files);
  }

  // 9. Generate advisory if requested
  if (options.advise) {
    bundle.advisory = await generateAdvisory(db, projectId, bundle, options.task);
  }

  return bundle;
}

// ============================================================================
// Helpers
// ============================================================================

async function getCochangingFiles(
  db: DatabaseAdapter,
  projectId: number,
  files: string[]
): Promise<Array<{ path: string; cochange_count: number }>> {
  const seen = new Set(files);
  const results: Array<{ path: string; cochange_count: number }> = [];

  for (const file of files) {
    const correlated = await getCorrelatedFiles(db, projectId, file, 3);
    for (const c of correlated) {
      if (!seen.has(c.file)) {
        seen.add(c.file);
        results.push({ path: c.file, cochange_count: c.cochange_count });
      }
    }
  }

  return results.sort((a, b) => b.cochange_count - a.cochange_count).slice(0, 10);
}

async function getBlastDependents(
  db: DatabaseAdapter,
  projectId: number,
  files: string[]
): Promise<Array<{ path: string; reason: string; confidence: number }>> {
  const results: Array<{ path: string; reason: string; confidence: number }> = [];
  const seen = new Set(files);

  for (const file of files) {
    try {
      const dependents = await db.all<{ affected_file: string; distance: number }>(`
        SELECT affected_file, distance FROM blast_radius
        WHERE project_id = ? AND source_file = ?
        ORDER BY distance ASC
        LIMIT 5
      `, [projectId, file]);

      for (const d of dependents) {
        if (!seen.has(d.affected_file)) {
          seen.add(d.affected_file);
          const confidence = Math.max(0.3, 1.0 - d.distance * 0.2);
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

async function searchForTask(
  db: DatabaseAdapter,
  projectId: number,
  task: string
): Promise<{
  decisions: Array<{ id: number; title: string }>;
  issues: Array<{ id: number; title: string; severity: number }>;
  learnings: Array<{ id: number; title: string; content: string; native?: string }>;
}> {
  const result = {
    decisions: [] as Array<{ id: number; title: string }>,
    issues: [] as Array<{ id: number; title: string; severity: number }>,
    learnings: [] as Array<{ id: number; title: string; content: string; native?: string }>,
  };

  // Search decisions via FTS
  try {
    result.decisions = await db.all<{ id: number; title: string }>(`
      SELECT d.id, d.title FROM fts_decisions
      JOIN decisions d ON fts_decisions.rowid = d.id
      WHERE fts_decisions MATCH ?1 AND d.project_id = ?2 AND d.status = 'active'
      ORDER BY bm25(fts_decisions)
      LIMIT 5
    `, [task, projectId]);
  } catch {
    /* FTS might fail */
  }

  // Search issues
  try {
    result.issues = await db.all<{ id: number; title: string; severity: number }>(`
      SELECT i.id, i.title, i.severity FROM fts_issues
      JOIN issues i ON fts_issues.rowid = i.id
      WHERE fts_issues MATCH ?1 AND i.project_id = ?2 AND i.status = 'open'
      ORDER BY i.severity DESC
      LIMIT 5
    `, [task, projectId]);
  } catch {
    /* FTS might fail */
  }

  // Search learnings with native format
  try {
    result.learnings = await db.all<{ id: number; title: string; content: string; native_format: string | null }>(`
      SELECT l.id, l.title, l.content, nk.native_format
      FROM fts_learnings
      JOIN learnings l ON fts_learnings.rowid = l.id
      LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
      WHERE fts_learnings MATCH ?1 AND (l.project_id = ?2 OR l.project_id IS NULL)
      ORDER BY bm25(fts_learnings)
      LIMIT 5
    `, [task, projectId]).then(rows => rows.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      native: r.native_format ?? undefined,
    })));
  } catch {
    /* FTS might fail or native_knowledge table might not exist */
    try {
      result.learnings = await db.all<{ id: number; title: string; content: string }>(`
        SELECT l.id, l.title, l.content FROM fts_learnings
        JOIN learnings l ON fts_learnings.rowid = l.id
        WHERE fts_learnings MATCH ?1 AND (l.project_id = ?2 OR l.project_id IS NULL)
        ORDER BY bm25(fts_learnings)
        LIMIT 5
      `, [task, projectId]);
    } catch {
      /* FTS might fail */
    }
  }

  return result;
}

async function searchRelatedFiles(
  db: DatabaseAdapter,
  projectId: number,
  task: string
): Promise<Array<{ path: string; reason: string; confidence: number }>> {
  try {
    const files = await db.all<{ path: string; purpose: string | null }>(`
      SELECT f.path, f.purpose FROM fts_files
      JOIN files f ON fts_files.rowid = f.id
      WHERE fts_files MATCH ?1 AND f.project_id = ?2
      ORDER BY bm25(fts_files)
      LIMIT 5
    `, [task, projectId]);

    return files.map((f, i) => ({
      path: f.path,
      reason: f.purpose?.slice(0, 60) ?? "Related to task",
      confidence: Math.max(0.3, 0.9 - i * 0.15),
    }));
  } catch {
    return [];
  }
}

async function getIssuesForFiles(
  db: DatabaseAdapter,
  projectId: number,
  files: string[]
): Promise<Array<{ id: number; title: string; severity: number }>> {
  try {
    const results: Array<{ id: number; title: string; severity: number }> = [];
    const seen = new Set<number>();

    for (const file of files) {
      const issues = await db.all<{ id: number; title: string; severity: number }>(`
        SELECT id, title, severity FROM issues
        WHERE project_id = ? AND status = 'open'
          AND affected_files LIKE '%' || ? || '%'
        ORDER BY severity DESC
        LIMIT 3
      `, [projectId, file]);

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

async function getApplicableWorkflow(
  db: DatabaseAdapter,
  projectId: number,
  task?: string
): Promise<{ task_type: string; approach: string } | null> {
  if (!task) return null;

  // Heuristic: match task description to workflow types
  const taskLower = task.toLowerCase();
  let taskType: string | null = null;

  if (taskLower.includes("review") || taskLower.includes("pr")) {
    taskType = "code_review";
  } else if (taskLower.includes("bug") || taskLower.includes("fix") || taskLower.includes("debug")) {
    taskType = "debugging";
  } else if (taskLower.includes("feature") || taskLower.includes("add") || taskLower.includes("implement")) {
    taskType = "feature_build";
  } else if (taskLower.includes("refactor") || taskLower.includes("clean")) {
    taskType = "refactor";
  } else if (taskLower.includes("research") || taskLower.includes("investigate")) {
    taskType = "research";
  }

  if (!taskType) return null;

  try {
    const workflow = await db.all<{ task_type: string; approach: string }>(`
      SELECT task_type, approach FROM workflow_patterns
      WHERE (project_id = ? OR project_id IS NULL) AND task_type = ?
      ORDER BY project_id DESC
      LIMIT 1
    `, [projectId, taskType]);

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
async function getLastSessionContext(db: DatabaseAdapter, projectId: number): Promise<PredictionBundle["lastSessionContext"]> {
  try {
    // Get last completed session
    const lastSession = await db.get<{ id: number; goal: string | null }>(`
      SELECT id, goal FROM sessions
      WHERE project_id = ? AND ended_at IS NOT NULL
      ORDER BY ended_at DESC
      LIMIT 1
    `, [projectId]);

    if (!lastSession) return null;

    const sessionId = lastSession.id;

    // Get decisions made during session (via "made" relationship)
    const decisionsMade = await db.all<{ id: number; title: string }>(`
      SELECT d.id, d.title FROM relationships r
      JOIN decisions d ON r.target_id = d.id AND r.target_type = 'decision'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'made'
      ORDER BY r.strength DESC
    `, [sessionId]);

    // Get issues found during session (via "found" relationship)
    const issuesFound = await db.all<{ id: number; title: string }>(`
      SELECT i.id, i.title FROM relationships r
      JOIN issues i ON r.target_id = i.id AND r.target_type = 'issue'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'found'
      ORDER BY r.strength DESC
    `, [sessionId]);

    // Get issues resolved during session (via "resolved" relationship)
    const issuesResolved = await db.all<{ id: number; title: string }>(`
      SELECT i.id, i.title FROM relationships r
      JOIN issues i ON r.target_id = i.id AND r.target_type = 'issue'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'resolved'
      ORDER BY r.strength DESC
    `, [sessionId]);

    // Get learnings extracted from session (via "learned" relationship)
    const learningsExtracted = await db.all<{ id: number; title: string }>(`
      SELECT l.id, l.title FROM relationships r
      JOIN learnings l ON r.target_id = l.id AND r.target_type = 'learning'
      WHERE r.source_type = 'session' AND r.source_id = ?
        AND r.relationship = 'learned'
      ORDER BY r.strength DESC
    `, [sessionId]);

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
async function getTestFilesForSources(
  db: DatabaseAdapter,
  projectId: number,
  files: string[]
): Promise<Array<{ testPath: string; sourcePath: string }>> {
  const results: Array<{ testPath: string; sourcePath: string }> = [];

  for (const sourcePath of files) {
    try {
      // Find file ID for source
      const sourceFile = await db.get<{ id: number }>("SELECT id FROM files WHERE project_id = ? AND path = ?", [projectId, sourcePath]);

      if (!sourceFile) continue;

      // Find test files via "tests" relationship (test → source)
      const testFiles = await db.all<{ path: string }>(`
        SELECT f.path FROM relationships r
        JOIN files f ON r.source_id = f.id AND r.source_type = 'file'
        WHERE r.target_type = 'file' AND r.target_id = ?
          AND r.relationship = 'tests'
      `, [sourceFile.id]);

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
// Advisory Generation
// ============================================================================

async function generateAdvisory(
  db: DatabaseAdapter,
  projectId: number,
  bundle: PredictionBundle,
  task?: string
): Promise<PredictionAdvisory> {
  const watchOut: PredictionAdvisory["watchOut"] = [];
  const suggestedSteps: string[] = [];

  // 1. Get gotchas from learnings
  const gotchas = await getGotchaLearnings(db, projectId, task);
  for (const g of gotchas) {
    watchOut.push({
      warning: g.content.slice(0, 100),
      source: `learning #${g.id}`,
      severity: "warning",
    });
  }

  // 2. Get decision outcomes (failed/revised ones are warnings)
  const outcomes = await getDecisionOutcomes(db, projectId, task);
  for (const d of outcomes) {
    if (d.outcome === "failed") {
      watchOut.push({
        warning: `Previous attempt failed: ${d.title}`,
        source: `decision #${d.id} (failed)`,
        severity: "critical",
      });
    } else if (d.outcome === "revised") {
      watchOut.push({
        warning: `Required revision: ${d.title}`,
        source: `decision #${d.id} (revised)`,
        severity: "warning",
      });
    }
  }

  // 3. Calculate risk from file fragility
  const { riskLevel, riskScore } = await calculateRisk(db, projectId, bundle);

  // 4. Add fragile file warnings
  for (const file of bundle.relatedFiles) {
    const fragility = await getFileFragility(db, projectId, file.path);
    if (fragility >= 7) {
      watchOut.push({
        warning: `Fragile file: ${file.path} (${fragility}/10)`,
        source: "file analysis",
        severity: fragility >= 8 ? "critical" : "warning",
      });
    }
  }

  // 5. Build suggested approach from workflow
  let suggestedApproach: string | null = null;
  if (bundle.workflowPattern) {
    suggestedApproach = bundle.workflowPattern.approach;
    suggestedSteps.push(`Follow ${bundle.workflowPattern.task_type} workflow`);
  }

  // 6. Add steps based on context
  if (bundle.testFiles.length > 0) {
    suggestedSteps.push(`Update tests: ${bundle.testFiles.map((t) => t.testPath).slice(0, 2).join(", ")}`);
  }
  if (bundle.openIssues.length > 0) {
    suggestedSteps.push(`Check open issues: ${bundle.openIssues.map((i) => `#${i.id}`).join(", ")}`);
  }
  if (riskLevel !== "low") {
    suggestedSteps.push("Run full test suite before committing");
  }

  return {
    riskLevel,
    riskScore,
    suggestedApproach,
    watchOut,
    decisionOutcomes: outcomes,
    suggestedSteps,
  };
}

async function getGotchaLearnings(
  db: DatabaseAdapter,
  projectId: number,
  task?: string
): Promise<Array<{ id: number; title: string; content: string }>> {
  try {
    // First try task-specific gotchas via FTS
    if (task) {
      const taskGotchas = await db.all<{ id: number; title: string; content: string }>(
        `
        SELECT l.id, l.title, l.content FROM fts_learnings
        JOIN learnings l ON fts_learnings.rowid = l.id
        WHERE fts_learnings MATCH ?1
          AND (l.project_id = ?2 OR l.project_id IS NULL)
          AND l.category = 'gotcha'
        ORDER BY bm25(fts_learnings)
        LIMIT 3
      `,
        [task, projectId]
      );

      if (taskGotchas.length > 0) return taskGotchas;
    }

    // Fallback to recent gotchas
    return await db.all<{ id: number; title: string; content: string }>(
      `
      SELECT id, title, content FROM learnings
      WHERE (project_id = ? OR project_id IS NULL)
        AND category = 'gotcha'
      ORDER BY times_applied DESC, created_at DESC
      LIMIT 3
    `,
      [projectId]
    );
  } catch {
    return [];
  }
}

async function getDecisionOutcomes(
  db: DatabaseAdapter,
  projectId: number,
  task?: string
): Promise<Array<{ id: number; title: string; outcome: OutcomeStatus; notes: string | null }>> {
  try {
    // Get decisions with recorded outcomes
    if (task) {
      const taskDecisions = await db.all<{
        id: number;
        title: string;
        outcome_status: OutcomeStatus;
        outcome_notes: string | null;
      }>(
        `
        SELECT d.id, d.title, d.outcome_status, d.outcome_notes
        FROM fts_decisions
        JOIN decisions d ON fts_decisions.rowid = d.id
        WHERE fts_decisions MATCH ?1
          AND d.project_id = ?2
          AND d.outcome_status != 'pending'
        ORDER BY d.outcome_at DESC
        LIMIT 5
      `,
        [task, projectId]
      );

      if (taskDecisions.length > 0) {
        return taskDecisions.map((d) => ({
          id: d.id,
          title: d.title,
          outcome: d.outcome_status,
          notes: d.outcome_notes,
        }));
      }
    }

    // Fallback to recent outcomes
    const recent = await db.all<{
      id: number;
      title: string;
      outcome_status: OutcomeStatus;
      outcome_notes: string | null;
    }>(
      `
      SELECT id, title, outcome_status, outcome_notes FROM decisions
      WHERE project_id = ?
        AND outcome_status IN ('failed', 'revised')
      ORDER BY outcome_at DESC
      LIMIT 5
    `,
      [projectId]
    );

    return recent.map((d) => ({
      id: d.id,
      title: d.title,
      outcome: d.outcome_status,
      notes: d.outcome_notes,
    }));
  } catch {
    return [];
  }
}

async function calculateRisk(
  db: DatabaseAdapter,
  projectId: number,
  bundle: PredictionBundle
): Promise<{ riskLevel: "low" | "medium" | "high"; riskScore: number }> {
  let score = 0;

  // Factor 1: Number of files involved
  const fileCount = bundle.relatedFiles.length + bundle.cochangingFiles.length;
  if (fileCount >= 10) score += 3;
  else if (fileCount >= 5) score += 2;
  else if (fileCount >= 3) score += 1;

  // Factor 2: Open issues severity
  const maxSeverity = Math.max(0, ...bundle.openIssues.map((i) => i.severity));
  if (maxSeverity >= 8) score += 3;
  else if (maxSeverity >= 5) score += 2;
  else if (maxSeverity > 0) score += 1;

  // Factor 3: File fragility (sample top 5 related files)
  for (const file of bundle.relatedFiles.slice(0, 5)) {
    const fragility = await getFileFragility(db, projectId, file.path);
    if (fragility >= 8) score += 2;
    else if (fragility >= 6) score += 1;
  }

  // Normalize to 0-10
  const riskScore = Math.min(10, score);

  let riskLevel: "low" | "medium" | "high";
  if (riskScore >= 7) riskLevel = "high";
  else if (riskScore >= 4) riskLevel = "medium";
  else riskLevel = "low";

  return { riskLevel, riskScore };
}

async function getFileFragility(db: DatabaseAdapter, projectId: number, path: string): Promise<number> {
  try {
    const file = await db.get<{ fragility: number }>("SELECT fragility FROM files WHERE project_id = ? AND path = ?", [
      projectId,
      path,
    ]);
    return file?.fragility ?? 0;
  } catch {
    return 0;
  }
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handlePredictCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const taskParts: string[] = [];
  const files: string[] = [];
  let mode: "task" | "files" = "task";
  let advise = false;

  for (const arg of args) {
    if (arg === "--files") {
      mode = "files";
      continue;
    }
    if (arg === "--advise") {
      advise = true;
      continue;
    }
    if (mode === "files") {
      files.push(arg);
    } else {
      taskParts.push(arg);
    }
  }

  const task = taskParts.join(" ") || undefined;

  if (!task && files.length === 0) {
    console.error("Usage: muninn predict <task description> [--files file1 file2 ...] [--advise]");
    return;
  }

  const bundle = await predictContext(db, projectId, { task, files, advise });

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
      if (l.native) {
        // Use native format (transformer-optimized)
        console.error(`     ${l.native}`);
      } else {
        // Fallback to prose
        console.error(`     ${l.title}: ${l.content.slice(0, 60)}`);
      }
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
      console.error(`     Decisions made: ${ctx.decisionsMade.map((d) => `D${d.id}`).join(", ")}`);
    }
    if (ctx.issuesFound.length > 0) {
      console.error(`     Issues found: ${ctx.issuesFound.map((i) => `#${i.id}`).join(", ")}`);
    }
    if (ctx.issuesResolved.length > 0) {
      console.error(`     Issues resolved: ${ctx.issuesResolved.map((i) => `#${i.id}`).join(", ")}`);
    }
    if (ctx.learningsExtracted.length > 0) {
      console.error(`     Learnings: ${ctx.learningsExtracted.map((l) => l.title.slice(0, 30)).join(", ")}`);
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

  // Advisory section (when --advise flag is used)
  if (bundle.advisory) {
    const a = bundle.advisory;
    const riskEmoji = a.riskLevel === "high" ? "🔴" : a.riskLevel === "medium" ? "🟡" : "🟢";

    console.error(`\n⚡ Advisory (${riskEmoji} ${a.riskLevel.toUpperCase()} risk, score: ${a.riskScore}/10):\n`);

    if (a.watchOut.length > 0) {
      console.error("  ⚠️  Watch Out:");
      for (const w of a.watchOut) {
        const icon = w.severity === "critical" ? "🔴" : w.severity === "warning" ? "🟠" : "💡";
        console.error(`     ${icon} ${w.warning}`);
        console.error(`        Source: ${w.source}`);
      }
      console.error("");
    }

    if (a.suggestedApproach) {
      console.error(`  📋 Approach: ${a.suggestedApproach.slice(0, 80)}`);
      console.error("");
    }

    if (a.suggestedSteps.length > 0) {
      console.error("  📝 Suggested Steps:");
      for (let i = 0; i < a.suggestedSteps.length; i++) {
        console.error(`     ${i + 1}. ${a.suggestedSteps[i]}`);
      }
      console.error("");
    }

    if (a.decisionOutcomes.length > 0) {
      console.error("  📊 Past Decision Outcomes:");
      for (const d of a.decisionOutcomes) {
        const icon = d.outcome === "succeeded" ? "✅" : d.outcome === "failed" ? "❌" : "🔄";
        console.error(`     ${icon} D#${d.id}: ${d.title} (${d.outcome})`);
        if (d.notes) console.error(`        Notes: ${d.notes.slice(0, 60)}`);
      }
      console.error("");
    }
  }

  outputJson(bundle);
}
