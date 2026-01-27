/**
 * Workflow Pattern commands
 * Track how the user works on different task types
 */

import type { DatabaseAdapter } from "../database/adapter";
import { outputSuccess } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

type TaskType = "code_review" | "debugging" | "feature_build" | "creative" | "research" | "refactor";

const VALID_TASK_TYPES: TaskType[] = ["code_review", "debugging", "feature_build", "creative", "research", "refactor"];

// ============================================================================
// Set Workflow (UPSERT)
// ============================================================================

export async function workflowSet(
  db: DatabaseAdapter,
  projectId: number | null,
  taskType: TaskType,
  approach: string,
  options: { preferences?: string; examples?: string; global?: boolean } = {}
): Promise<number> {
  if (!taskType || !approach) {
    console.error("Usage: muninn workflow set <task_type> <approach> [--preferences <json>]");
    process.exit(1);
  }

  if (!VALID_TASK_TYPES.includes(taskType)) {
    console.error(`Invalid task type. Must be one of: ${VALID_TASK_TYPES.join(", ")}`);
    process.exit(1);
  }

  if (options.global) {
    return workflowSetGlobal(db, taskType, approach, options.preferences, options.examples);
  }

  // UPSERT: update if exists, insert if not
  const existing = await db.get<{ id: number; times_used: number }>(`
    SELECT id, times_used FROM workflow_patterns
    WHERE project_id = ? AND task_type = ?
  `, [projectId, taskType]);

  if (existing) {
    await db.run(
      `
      UPDATE workflow_patterns
      SET approach = ?, preferences = ?, examples = ?,
          times_used = times_used + 1,
          last_used_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [approach, options.preferences ?? null, options.examples ?? null, existing.id]
    );

    console.error(`\n🔄 Workflow updated for "${taskType}" (used ${existing.times_used + 1}x)`);
    outputSuccess({ id: existing.id, taskType, approach, updated: true });
    return existing.id;
  }

  const result = await db.run(
    `
    INSERT INTO workflow_patterns (project_id, task_type, approach, preferences, examples, last_used_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `,
    [projectId, taskType, approach, options.preferences ?? null, options.examples ?? null]
  );

  const id = Number(result.lastInsertRowid);
  console.error(`\n🔄 Workflow set for "${taskType}"`);
  console.error(`   Approach: ${approach.slice(0, 60)}`);

  outputSuccess({ id, taskType, approach, updated: false });
  return id;
}

async function workflowSetGlobal(
  db: DatabaseAdapter,
  taskType: TaskType,
  approach: string,
  preferences?: string,
  examples?: string
): Promise<number> {
  // UPSERT on global table
  const existing = await db.get<{ id: number; times_used: number }>(`
    SELECT id, times_used FROM global_workflow_patterns WHERE task_type = ?
  `, [taskType]);

  if (existing) {
    await db.run(
      `
      UPDATE global_workflow_patterns
      SET approach = ?, preferences = ?, examples = ?,
          times_used = times_used + 1,
          last_used_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [approach, preferences ?? null, examples ?? null, existing.id]
    );

    console.error(`\n🔄 Global workflow updated for "${taskType}"`);
    outputSuccess({ id: existing.id, taskType, approach, updated: true, global: true });
    return existing.id;
  }

  const result = await db.run(
    `
    INSERT INTO global_workflow_patterns (task_type, approach, preferences, examples, last_used_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `,
    [taskType, approach, preferences ?? null, examples ?? null]
  );

  const id = Number(result.lastInsertRowid);
  console.error(`\n🔄 Global workflow set for "${taskType}"`);
  outputSuccess({ id, taskType, approach, updated: false, global: true });
  return id;
}

// ============================================================================
// Get Workflow
// ============================================================================

export async function workflowGet(
  db: DatabaseAdapter,
  projectId: number | null,
  taskType: TaskType,
  options: { global?: boolean } = {}
): Promise<void> {
  if (!taskType) {
    console.error("Usage: muninn workflow get <task_type>");
    process.exit(1);
  }

  if (options.global) {
    const pattern = await db.get<{
      id: number;
      task_type: string;
      approach: string;
      preferences: string | null;
      examples: string | null;
      times_used: number;
      last_used_at: string | null;
    }>(`
      SELECT * FROM global_workflow_patterns WHERE task_type = ?
    `, [taskType]);

    if (!pattern) {
      console.error(`No global workflow found for "${taskType}"`);
      outputSuccess({ found: false, taskType, global: true });
      return;
    }

    console.error(`\n🔄 Global Workflow: ${taskType}`);
    console.error(`   Approach: ${pattern.approach}`);
    if (pattern.preferences) console.error(`   Preferences: ${pattern.preferences}`);
    console.error(`   Used: ${pattern.times_used}x`);
    outputSuccess({ ...pattern, global: true });
    return;
  }

  // Try project-local first, fall back to global
  const pattern = await db.get<{
    id: number;
    task_type: string;
    approach: string;
    preferences: string | null;
    examples: string | null;
    times_used: number;
    last_used_at: string | null;
  }>(`
    SELECT * FROM workflow_patterns
    WHERE project_id = ? AND task_type = ?
  `, [projectId, taskType]);

  if (pattern) {
    console.error(`\n🔄 Workflow: ${taskType}`);
    console.error(`   Approach: ${pattern.approach}`);
    if (pattern.preferences) console.error(`   Preferences: ${pattern.preferences}`);
    console.error(`   Used: ${pattern.times_used}x`);
    outputSuccess(pattern);
    return;
  }

  // Fall back to global
  const globalPattern = await db.get<{
    id: number;
    task_type: string;
    approach: string;
    preferences: string | null;
    examples: string | null;
    times_used: number;
  }>(`
    SELECT * FROM global_workflow_patterns WHERE task_type = ?
  `, [taskType]);

  if (globalPattern) {
    console.error(`\n🔄 Workflow (global): ${taskType}`);
    console.error(`   Approach: ${globalPattern.approach}`);
    outputSuccess({ ...globalPattern, source: "global" });
    return;
  }

  console.error(`No workflow found for "${taskType}"`);
  outputSuccess({ found: false, taskType });
}

// ============================================================================
// List Workflows
// ============================================================================

export async function workflowList(db: DatabaseAdapter, projectId: number | null, options: { global?: boolean } = {}): Promise<void> {
  if (options.global) {
    const patterns = await db.all<{
      id: number;
      task_type: string;
      approach: string;
      times_used: number;
      last_used_at: string | null;
    }>(`
      SELECT id, task_type, approach, times_used, last_used_at
      FROM global_workflow_patterns
      ORDER BY times_used DESC
    `, []);

    console.error(`\n🔄 Global Workflows (${patterns.length})\n`);
    for (const p of patterns) {
      console.error(`  ${p.task_type}: ${p.approach.slice(0, 50)} (${p.times_used}x)`);
    }
    outputSuccess({ workflows: patterns, global: true });
    return;
  }

  const patterns = await db.all<{
    id: number;
    task_type: string;
    approach: string;
    times_used: number;
    last_used_at: string | null;
  }>(`
    SELECT id, task_type, approach, times_used, last_used_at
    FROM workflow_patterns
    WHERE project_id = ?
    ORDER BY times_used DESC
  `, [projectId]);

  console.error(`\n🔄 Workflows (${patterns.length})\n`);
  for (const p of patterns) {
    console.error(`  ${p.task_type}: ${p.approach.slice(0, 50)} (${p.times_used}x)`);
  }
  outputSuccess({ workflows: patterns });
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleWorkflowCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "set": {
      const taskType = args[1] as TaskType;
      const approach = args
        .slice(2)
        .filter((a) => !a.startsWith("--"))
        .join(" ");
      const prefIdx = args.indexOf("--preferences");
      const preferences = prefIdx !== -1 ? args[prefIdx + 1] : undefined;
      const exIdx = args.indexOf("--examples");
      const examples = exIdx !== -1 ? args[exIdx + 1] : undefined;
      const isGlobal = args.includes("--global");
      await workflowSet(db, isGlobal ? null : projectId, taskType, approach, { preferences, examples, global: isGlobal });
      break;
    }

    case "get": {
      const taskType = args[1] as TaskType;
      const isGlobal = args.includes("--global");
      await workflowGet(db, isGlobal ? null : projectId, taskType, { global: isGlobal });
      break;
    }

    case "list": {
      const isGlobal = args.includes("--global");
      await workflowList(db, isGlobal ? null : projectId, { global: isGlobal });
      break;
    }

    default:
      console.error("Usage: muninn workflow <set|get|list> [args]");
  }
}
