/**
 * Advisory Generation
 * Risk assessment, gotcha detection, and step suggestions.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import type { OutcomeStatus, PredictionAdvisory, PredictionBundle } from "../../types.js";

export async function generateAdvisory(
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
