/**
 * Onboarding Context Generator — What you need to know
 *
 * Auto-generates a structured onboarding document for a project:
 * - Architecture overview (from decisions + file structure)
 * - Danger zones (fragile files + common errors)
 * - Workflows (from file correlations + patterns)
 * - Team standards (from review patterns + conventions)
 *
 * Cached and regenerated weekly. Never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface OnboardingContext {
  sections: OnboardingSection[];
  generatedAt: string;
}

interface OnboardingSection {
  section: string;
  content: string;
}

// ============================================================================
// Section Generators
// ============================================================================

/** Architecture section: key decisions and file organization */
async function generateArchitectureSection(
  db: DatabaseAdapter,
  projectId: number
): Promise<string> {
  const lines: string[] = ["## Architecture\n"];

  try {
    // Key decisions
    const decisions = await db.all<{ title: string; decision: string; outcome_status: string }>(
      `SELECT title, decision, outcome_status FROM decisions
       WHERE project_id = ? AND status = 'active'
       ORDER BY CASE outcome_status WHEN 'succeeded' THEN 0 ELSE 1 END, decided_at DESC
       LIMIT 10`,
      [projectId]
    );

    if (decisions.length > 0) {
      lines.push("### Key Decisions");
      for (const d of decisions) {
        const status = d.outcome_status === "succeeded" ? "[OK]" : "[?]";
        lines.push(`- ${status} ${d.title}: ${d.decision.slice(0, 120)}`);
      }
      lines.push("");
    }

    // File structure overview (top directories by file count)
    const dirs = await db.all<{ dir: string; cnt: number }>(
      `SELECT
         CASE WHEN INSTR(path, '/') > 0
           THEN SUBSTR(path, 1, INSTR(path, '/') - 1)
           ELSE path
         END as dir,
         COUNT(*) as cnt
       FROM files WHERE project_id = ?
       GROUP BY dir
       ORDER BY cnt DESC
       LIMIT 8`,
      [projectId]
    );

    if (dirs.length > 0) {
      lines.push("### Project Structure");
      for (const d of dirs) {
        lines.push(`- ${d.dir}/ (${d.cnt} files)`);
      }
      lines.push("");
    }
  } catch {
    lines.push("(No architecture data available yet)\n");
  }

  return lines.join("\n");
}

/** Danger zones: fragile files and common errors */
async function generateDangerSection(
  db: DatabaseAdapter,
  projectId: number
): Promise<string> {
  const lines: string[] = ["## Danger Zones\n"];

  try {
    // Fragile files
    const fragile = await db.all<{ path: string; fragility: number; fragility_reason: string | null }>(
      `SELECT path, fragility, fragility_reason FROM files
       WHERE project_id = ? AND fragility >= 7
       ORDER BY fragility DESC
       LIMIT 10`,
      [projectId]
    );

    if (fragile.length > 0) {
      lines.push("### Fragile Files (handle with care)");
      for (const f of fragile) {
        lines.push(`- [${f.fragility}/10] ${f.path}${f.fragility_reason ? ` — ${f.fragility_reason}` : ""}`);
      }
      lines.push("");
    }

    // Common errors
    const errors = await db.all<{ error_type: string; error_signature: string; fix_description: string }>(
      `SELECT error_type, error_signature, fix_description FROM error_fix_pairs
       WHERE project_id = ? AND confidence >= 0.5
       ORDER BY times_seen DESC
       LIMIT 5`,
      [projectId]
    );

    if (errors.length > 0) {
      lines.push("### Common Errors (with known fixes)");
      for (const e of errors) {
        lines.push(`- ${e.error_type}: ${e.error_signature.slice(0, 60)} -> ${e.fix_description.slice(0, 80)}`);
      }
      lines.push("");
    }

    // Open issues
    const issues = await db.all<{ title: string; severity: number; type: string }>(
      `SELECT title, severity, type FROM issues
       WHERE project_id = ? AND status = 'open'
       ORDER BY severity DESC
       LIMIT 5`,
      [projectId]
    );

    if (issues.length > 0) {
      lines.push("### Open Issues");
      for (const i of issues) {
        lines.push(`- [sev ${i.severity}] ${i.type}: ${i.title}`);
      }
      lines.push("");
    }
  } catch {
    lines.push("(No danger zone data available yet)\n");
  }

  return lines.join("\n");
}

/** Workflows: how things get done */
async function generateWorkflowSection(
  db: DatabaseAdapter,
  projectId: number
): Promise<string> {
  const lines: string[] = ["## Workflows\n"];

  try {
    // File correlations (files that change together)
    const correlations = await db.all<{
      file_a: string;
      file_b: string;
      co_change_count: number;
    }>(
      `SELECT file_a, file_b, co_change_count FROM file_correlations
       WHERE project_id = ? AND co_change_count >= 3
       ORDER BY co_change_count DESC
       LIMIT 8`,
      [projectId]
    );

    if (correlations.length > 0) {
      lines.push("### Files That Change Together");
      for (const c of correlations) {
        const a = c.file_a.split("/").pop();
        const b = c.file_b.split("/").pop();
        lines.push(`- ${a} + ${b} (${c.co_change_count} times)`);
      }
      lines.push("");
    }

    // Workflow patterns from insights
    const workflows = await db.all<{ title: string; content: string }>(
      `SELECT title, content FROM insights
       WHERE project_id = ? AND type = 'pattern'
       ORDER BY generated_at DESC
       LIMIT 5`,
      [projectId]
    );

    if (workflows.length > 0) {
      lines.push("### Detected Patterns");
      for (const w of workflows) {
        lines.push(`- ${w.title}: ${w.content.slice(0, 100)}`);
      }
      lines.push("");
    }
  } catch {
    lines.push("(No workflow data available yet)\n");
  }

  return lines.join("\n");
}

/** Standards: coding conventions and review patterns */
async function generateStandardsSection(
  db: DatabaseAdapter,
  projectId: number
): Promise<string> {
  const lines: string[] = ["## Standards\n"];

  try {
    // Convention learnings
    const conventions = await db.all<{ title: string; content: string }>(
      `SELECT title, content FROM learnings
       WHERE project_id = ? AND category = 'convention' AND confidence >= 5
       ORDER BY confidence DESC
       LIMIT 8`,
      [projectId]
    );

    if (conventions.length > 0) {
      lines.push("### Coding Conventions");
      for (const c of conventions) {
        lines.push(`- ${c.title}: ${c.content.slice(0, 100)}`);
      }
      lines.push("");
    }

    // Review patterns
    const reviews = await db.all<{ review_category: string; pattern: string; occurrence_count: number }>(
      `SELECT review_category, pattern, occurrence_count FROM pr_review_extracts
       WHERE project_id = ? AND occurrence_count >= 2
       ORDER BY occurrence_count DESC
       LIMIT 5`,
      [projectId]
    );

    if (reviews.length > 0) {
      lines.push("### Review Patterns");
      for (const r of reviews) {
        lines.push(`- [${r.review_category}] ${r.pattern} (${r.occurrence_count}x)`);
      }
      lines.push("");
    }

    // Team learnings
    const teamLearnings = await db.all<{ title: string; content: string }>(
      `SELECT title, content FROM team_learnings
       WHERE project_id = ? AND confidence >= 0.7
       ORDER BY confidence DESC
       LIMIT 5`,
      [projectId]
    );

    if (teamLearnings.length > 0) {
      lines.push("### Team Knowledge");
      for (const t of teamLearnings) {
        lines.push(`- ${t.title}: ${t.content.slice(0, 100)}`);
      }
      lines.push("");
    }
  } catch {
    lines.push("(No standards data available yet)\n");
  }

  return lines.join("\n");
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate full onboarding context for a project.
 * Caches result for 7 days.
 */
export async function generateOnboardingContext(
  db: DatabaseAdapter,
  projectId: number,
  forceRefresh: boolean = false
): Promise<OnboardingContext> {
  // Check cache
  if (!forceRefresh) {
    try {
      const cached = await db.all<{ section: string; content: string; generated_at: string }>(
        `SELECT section, content, generated_at FROM onboarding_contexts
         WHERE project_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY id ASC`,
        [projectId]
      );

      if (cached.length > 0) {
        return {
          sections: cached.map((c) => ({ section: c.section, content: c.content })),
          generatedAt: cached[0].generated_at,
        };
      }
    } catch {
      // Table might not exist
    }
  }

  // Generate fresh sections
  const architecture = await generateArchitectureSection(db, projectId);
  const danger = await generateDangerSection(db, projectId);
  const workflows = await generateWorkflowSection(db, projectId);
  const standards = await generateStandardsSection(db, projectId);

  const sections: OnboardingSection[] = [
    { section: "architecture", content: architecture },
    { section: "danger_zones", content: danger },
    { section: "workflows", content: workflows },
    { section: "standards", content: standards },
  ];

  // Cache sections (expire in 7 days)
  try {
    for (const section of sections) {
      await db.run(
        `INSERT INTO onboarding_contexts (project_id, section, content, generated_at, expires_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now', '+7 days'))
         ON CONFLICT(project_id, section) DO UPDATE SET
           content = excluded.content,
           generated_at = excluded.generated_at,
           expires_at = excluded.expires_at`,
        [projectId, section.section, section.content]
      );
    }
  } catch {
    // Table might not exist
  }

  return {
    sections,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format onboarding context as a single string.
 */
export function formatOnboardingContext(context: OnboardingContext): string {
  return context.sections
    .map((s) => s.content)
    .join("\n---\n\n");
}
