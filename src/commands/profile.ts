/**
 * Developer Profile Engine
 * Learns and tracks developer preferences, coding style, and patterns.
 * Supports both declared (explicit) and inferred (from data) preferences.
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { DeveloperProfileEntry, ProfileCategory, ProfileSource } from "../types";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Profile Show
// ============================================================================

export async function profileShow(
  db: DatabaseAdapter,
  projectId: number,
  options?: { category?: ProfileCategory }
): Promise<DeveloperProfileEntry[]> {
  const categoryFilter = options?.category ? "AND category = ?" : "";

  const params: (number | string)[] = [projectId];
  if (options?.category) params.push(options.category);

  const entries = await db.all<DeveloperProfileEntry>(`
    SELECT * FROM developer_profile
    WHERE project_id = ? ${categoryFilter}
    ORDER BY confidence DESC, times_confirmed DESC
  `, params);

  return entries;
}

// ============================================================================
// Profile Add (Declare)
// ============================================================================

export async function profileAdd(
  db: DatabaseAdapter,
  projectId: number,
  key: string,
  value: string,
  category: ProfileCategory,
  isGlobal: boolean = false
): Promise<void> {
  if (isGlobal) {
    await db.run(
      `
      INSERT INTO global_developer_profile (key, value, category, source, confidence)
      VALUES (?, ?, ?, 'declared', 0.9)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        source = 'declared',
        confidence = MAX(confidence, 0.9),
        times_confirmed = times_confirmed + 1,
        last_updated_at = CURRENT_TIMESTAMP
    `,
      [key, value, category]
    );
  } else {
    await db.run(
      `
      INSERT INTO developer_profile (project_id, key, value, category, source, confidence)
      VALUES (?, ?, ?, ?, 'declared', 0.9)
      ON CONFLICT(project_id, key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        source = 'declared',
        confidence = MAX(confidence, 0.9),
        times_confirmed = times_confirmed + 1,
        last_updated_at = CURRENT_TIMESTAMP
    `,
      [projectId, key, value, category]
    );
  }
}

// ============================================================================
// Profile Infer
// ============================================================================

export async function profileInfer(db: DatabaseAdapter, projectId: number): Promise<DeveloperProfileEntry[]> {
  const inferred: DeveloperProfileEntry[] = [];

  // Infer from observations (high-frequency patterns)
  await inferFromObservations(db, projectId, inferred);

  // Infer from decisions (consistent choices)
  await inferFromDecisions(db, projectId, inferred);

  // Infer from learnings (established preferences)
  await inferFromLearnings(db, projectId, inferred);

  // Infer from workflow patterns
  await inferFromWorkflows(db, projectId, inferred);

  // Persist inferred entries
  for (const entry of inferred) {
    await db.run(
      `
      INSERT INTO developer_profile (project_id, key, value, evidence, confidence, category, source)
      VALUES (?, ?, ?, ?, ?, ?, 'inferred')
      ON CONFLICT(project_id, key) DO UPDATE SET
        value = CASE WHEN source = 'declared' THEN value ELSE excluded.value END,
        evidence = excluded.evidence,
        confidence = CASE WHEN source = 'declared' THEN confidence
                         ELSE MIN(1.0, confidence + 0.1) END,
        times_confirmed = times_confirmed + 1,
        last_updated_at = CURRENT_TIMESTAMP
    `,
      [projectId, entry.key, entry.value, entry.evidence, entry.confidence, entry.category]
    );
  }

  return inferred;
}

async function inferFromObservations(db: DatabaseAdapter, projectId: number, results: DeveloperProfileEntry[]): Promise<void> {
  try {
    const patterns = await db.all<{ content: string; frequency: number; type: string }>(`
      SELECT content, frequency, type FROM observations
      WHERE (project_id = ? OR project_id IS NULL)
        AND type IN ('preference', 'pattern', 'behavior')
        AND frequency >= 2
      ORDER BY frequency DESC
      LIMIT 10
    `, [projectId]);

    for (const p of patterns) {
      const confidence = Math.min(0.9, 0.4 + p.frequency * 0.1);
      results.push({
        id: 0,
        project_id: projectId,
        key: `obs_${p.type}_${results.length}`,
        value: p.content.slice(0, 200),
        evidence: JSON.stringify([`Observed ${p.frequency}x`]),
        confidence,
        category: p.type === "preference" ? "coding_style" : "workflow",
        source: "inferred" as ProfileSource,
        times_confirmed: p.frequency,
        last_updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }
  } catch {
    // Table might not exist
  }
}

async function inferFromDecisions(db: DatabaseAdapter, projectId: number, results: DeveloperProfileEntry[]): Promise<void> {
  try {
    // Find decisions with successful outcomes
    const successfulDecisions = await db.all<{ title: string; decision: string; reasoning: string | null }>(`
      SELECT title, decision, reasoning FROM decisions
      WHERE project_id = ? AND status = 'active'
        AND outcome_status = 'succeeded'
      ORDER BY decided_at DESC
      LIMIT 5
    `, [projectId]);

    for (const d of successfulDecisions) {
      results.push({
        id: 0,
        project_id: projectId,
        key: `decision_pattern_${results.length}`,
        value: d.decision.slice(0, 200),
        evidence: JSON.stringify([`Decision: ${d.title}`, d.reasoning?.slice(0, 100)]),
        confidence: 0.7,
        category: "architecture",
        source: "inferred" as ProfileSource,
        times_confirmed: 1,
        last_updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }
  } catch {
    // outcome_status column might not exist yet
  }
}

async function inferFromLearnings(db: DatabaseAdapter, projectId: number, results: DeveloperProfileEntry[]): Promise<void> {
  try {
    const learnings = await db.all<{ title: string; content: string; category: string; times_applied: number }>(`
      SELECT title, content, category, times_applied FROM learnings
      WHERE (project_id = ? OR project_id IS NULL)
        AND category IN ('preference', 'convention', 'pattern')
        AND times_applied >= 2
      ORDER BY times_applied DESC
      LIMIT 5
    `, [projectId]);

    for (const l of learnings) {
      const confidence = Math.min(0.9, 0.5 + l.times_applied * 0.05);
      const category: ProfileCategory = l.category === "convention" ? "coding_style" : "workflow";
      results.push({
        id: 0,
        project_id: projectId,
        key: `learning_${l.title.replace(/\s+/g, "_").slice(0, 30)}`,
        value: l.content.slice(0, 200),
        evidence: JSON.stringify([`Learning applied ${l.times_applied}x`]),
        confidence,
        category,
        source: "inferred" as ProfileSource,
        times_confirmed: l.times_applied,
        last_updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }
  } catch {
    // Learnings table structure might differ
  }
}

async function inferFromWorkflows(db: DatabaseAdapter, projectId: number, results: DeveloperProfileEntry[]): Promise<void> {
  try {
    const workflows = await db.all<{ task_type: string; approach: string; times_used: number }>(`
      SELECT task_type, approach, times_used FROM workflow_patterns
      WHERE (project_id = ? OR project_id IS NULL)
        AND times_used >= 2
      ORDER BY times_used DESC
      LIMIT 5
    `, [projectId]);

    for (const w of workflows) {
      results.push({
        id: 0,
        project_id: projectId,
        key: `workflow_${w.task_type}`,
        value: w.approach.slice(0, 200),
        evidence: JSON.stringify([`Used ${w.times_used}x for ${w.task_type}`]),
        confidence: Math.min(0.9, 0.5 + w.times_used * 0.1),
        category: "workflow",
        source: "inferred" as ProfileSource,
        times_confirmed: w.times_used,
        last_updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }
  } catch {
    // Table might not exist
  }
}

// ============================================================================
// Profile Evolve (Re-score from evidence)
// ============================================================================

export async function profileEvolve(db: DatabaseAdapter, projectId: number): Promise<void> {
  try {
    // Decay confidence for entries not recently confirmed
    await db.run(
      `
      UPDATE developer_profile
      SET confidence = MAX(0.1, confidence - 0.05)
      WHERE project_id = ?
        AND source = 'inferred'
        AND last_updated_at < datetime('now', '-30 days')
    `,
      [projectId]
    );

    // Boost confidence for frequently confirmed entries
    await db.run(
      `
      UPDATE developer_profile
      SET confidence = MIN(1.0, confidence + 0.05)
      WHERE project_id = ?
        AND times_confirmed >= 5
        AND confidence < 0.95
    `,
      [projectId]
    );
  } catch {
    // Table might not exist
  }
}

// ============================================================================
// Profile Helpers
// ============================================================================

export async function getTopProfileEntries(
  db: DatabaseAdapter,
  projectId: number,
  limit: number = 5
): Promise<Array<{ key: string; value: string; confidence: number; category: string }>> {
  try {
    // Get project-specific entries
    const projectEntries = await db.all<{
      key: string;
      value: string;
      confidence: number;
      category: string;
    }>(`
      SELECT key, value, confidence, category FROM developer_profile
      WHERE project_id = ?
      ORDER BY confidence DESC, times_confirmed DESC
      LIMIT ?
    `, [projectId, limit]);

    // If not enough, supplement with global entries
    if (projectEntries.length < limit) {
      const globalEntries = await db.all<{
        key: string;
        value: string;
        confidence: number;
        category: string;
      }>(`
        SELECT key, value, confidence, category FROM global_developer_profile
        ORDER BY confidence DESC, times_confirmed DESC
        LIMIT ?
      `, [limit - projectEntries.length]);

      return [...projectEntries, ...globalEntries];
    }

    return projectEntries;
  } catch {
    return [];
  }
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleProfileCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "show":
    case "list":
    case undefined: {
      const category = args.find((a) =>
        ["coding_style", "architecture", "tooling", "workflow", "communication"].includes(a)
      ) as ProfileCategory | undefined;
      const entries = await profileShow(db, projectId, { category });

      if (entries.length === 0) {
        console.error("No profile entries yet. Run `muninn profile infer` or add with `muninn profile add`.");
        outputJson([]);
        return;
      }

      console.error("\n👤 Developer Profile:\n");
      for (const e of entries) {
        const pct = Math.round(e.confidence * 100);
        console.error(`  [${e.category}] ${e.key} (${pct}%): ${e.value.slice(0, 60)}`);
      }
      console.error("");
      outputJson(entries);
      break;
    }

    case "add": {
      const keyIdx = args.indexOf("--key");
      const valueIdx = args.indexOf("--value");
      const catIdx = args.indexOf("--category");
      const isGlobal = args.includes("--global");

      const key = keyIdx !== -1 ? args[keyIdx + 1] : args[1];
      const value = valueIdx !== -1 ? args[valueIdx + 1] : args[2];
      const category = (catIdx !== -1 ? args[catIdx + 1] : "coding_style") as ProfileCategory;

      if (!key || !value) {
        console.error("Usage: muninn profile add <key> <value> [--category <cat>] [--global]");
        return;
      }

      await profileAdd(db, projectId, key, value, category, isGlobal);
      console.error(`✅ Profile entry added: ${key} = ${value}`);
      outputSuccess({ key, value, category, global: isGlobal });
      break;
    }

    case "infer": {
      console.error("🔍 Inferring profile from project data...\n");
      const inferred = await profileInfer(db, projectId);

      if (inferred.length === 0) {
        console.error("No patterns detected yet. Use the system more to build a profile.");
      } else {
        console.error(`Found ${inferred.length} preference(s):\n`);
        for (const e of inferred) {
          const pct = Math.round(e.confidence * 100);
          console.error(`  [${e.category}] ${e.key} (${pct}%): ${e.value.slice(0, 60)}`);
        }
      }
      console.error("");
      outputJson(inferred);
      break;
    }

    case "evolve": {
      await profileEvolve(db, projectId);
      console.error("✅ Profile confidence scores evolved.");
      outputSuccess({ evolved: true });
      break;
    }

    default:
      console.error("Usage: muninn profile <show|add|infer|evolve>");
  }
}
