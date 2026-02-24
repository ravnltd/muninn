/**
 * Codebase DNA — v7 Phase 1C
 *
 * A compact "genome" (~500 tokens) summarizing the project.
 * Synthesized from existing tables (files, learnings, decisions, developer_profile).
 * Regenerated every 20 sessions via background job.
 *
 * Eliminates the need for new sessions to re-explore the project.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface CodebaseDNA {
  identity: {
    name: string;
    type: string;
    stack: string[];
    primaryLanguage: string;
  };
  architecture: {
    patterns: string[];
    entryPoints: string[];
    keyAbstractions: string[];
  };
  conventions: {
    naming: string;
    fileOrg: string;
    errorHandling: string;
    testing: string;
  };
  dangerZones: {
    fragileFiles: Array<{ path: string; fragility: number }>;
    knownPitfalls: string[];
    criticalPaths: string[];
  };
  teamKnowledge: {
    topLearnings: string[];
    failedDecisions: string[];
    activeIssues: string[];
  };
  generatedAt: string;
  sessionCount: number;
}

// ============================================================================
// Generation
// ============================================================================

/**
 * Generate the codebase DNA from existing project data.
 */
export async function generateCodebaseDNA(
  db: DatabaseAdapter,
  projectId: number,
): Promise<CodebaseDNA> {
  const [identity, architecture, conventions, dangerZones, teamKnowledge, sessionCount] =
    await Promise.all([
      collectIdentity(db, projectId),
      collectArchitecture(db, projectId),
      collectConventions(db, projectId),
      collectDangerZones(db, projectId),
      collectTeamKnowledge(db, projectId),
      getSessionCount(db, projectId),
    ]);

  return {
    identity,
    architecture,
    conventions,
    dangerZones,
    teamKnowledge,
    generatedAt: new Date().toISOString(),
    sessionCount,
  };
}

/**
 * Format DNA into compact text (~500 tokens).
 */
export function formatDNA(dna: CodebaseDNA): string {
  const sections: string[] = [];

  // Identity
  sections.push(
    `PROJECT: ${dna.identity.name} (${dna.identity.type})`,
    `STACK: ${dna.identity.stack.join(", ")} | Primary: ${dna.identity.primaryLanguage}`,
  );

  // Architecture
  if (dna.architecture.entryPoints.length > 0) {
    sections.push(`ENTRY: ${dna.architecture.entryPoints.join(", ")}`);
  }
  if (dna.architecture.patterns.length > 0) {
    sections.push(`PATTERNS: ${dna.architecture.patterns.join(", ")}`);
  }
  if (dna.architecture.keyAbstractions.length > 0) {
    sections.push(`ABSTRACTIONS: ${dna.architecture.keyAbstractions.join(", ")}`);
  }

  // Conventions
  const convParts: string[] = [];
  if (dna.conventions.naming) convParts.push(`naming:${dna.conventions.naming}`);
  if (dna.conventions.fileOrg) convParts.push(`org:${dna.conventions.fileOrg}`);
  if (dna.conventions.testing) convParts.push(`testing:${dna.conventions.testing}`);
  if (convParts.length > 0) {
    sections.push(`CONVENTIONS: ${convParts.join(" | ")}`);
  }

  // Danger zones
  if (dna.dangerZones.fragileFiles.length > 0) {
    const fragile = dna.dangerZones.fragileFiles
      .slice(0, 5)
      .map((f) => `${f.path}(${f.fragility})`)
      .join(", ");
    sections.push(`FRAGILE: ${fragile}`);
  }
  if (dna.dangerZones.knownPitfalls.length > 0) {
    sections.push(`PITFALLS: ${dna.dangerZones.knownPitfalls.slice(0, 3).join(" | ")}`);
  }

  // Team knowledge
  if (dna.teamKnowledge.topLearnings.length > 0) {
    sections.push(`TOP KNOWLEDGE: ${dna.teamKnowledge.topLearnings.slice(0, 5).join(" | ")}`);
  }
  if (dna.teamKnowledge.failedDecisions.length > 0) {
    sections.push(`FAILED DECISIONS: ${dna.teamKnowledge.failedDecisions.slice(0, 3).join(" | ")}`);
  }
  if (dna.teamKnowledge.activeIssues.length > 0) {
    sections.push(`ACTIVE ISSUES: ${dna.teamKnowledge.activeIssues.slice(0, 3).join(" | ")}`);
  }

  sections.push(`[Generated: ${dna.generatedAt.split("T")[0]} | Sessions: ${dna.sessionCount}]`);

  return sections.join("\n");
}

/**
 * Store DNA in the database.
 */
export async function persistDNA(
  db: DatabaseAdapter,
  projectId: number,
  dna: CodebaseDNA,
): Promise<void> {
  const formatted = formatDNA(dna);
  try {
    await db.run(
      `INSERT OR REPLACE INTO codebase_dna (project_id, dna_json, formatted_text, generated_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [projectId, JSON.stringify(dna), formatted],
    );
  } catch {
    // Table may not exist yet
  }
}

/**
 * Load cached DNA from the database.
 */
export async function loadDNA(
  db: DatabaseAdapter,
  projectId: number,
): Promise<{ dna: CodebaseDNA; formatted: string } | null> {
  try {
    const row = await db.get<{ dna_json: string; formatted_text: string }>(
      `SELECT dna_json, formatted_text FROM codebase_dna WHERE project_id = ?`,
      [projectId],
    );
    if (row) {
      return {
        dna: JSON.parse(row.dna_json) as CodebaseDNA,
        formatted: row.formatted_text,
      };
    }
  } catch {
    // Table may not exist
  }
  return null;
}

// ============================================================================
// Data Collectors
// ============================================================================

async function collectIdentity(
  db: DatabaseAdapter,
  projectId: number,
): Promise<CodebaseDNA["identity"]> {
  const result: CodebaseDNA["identity"] = {
    name: "Unknown",
    type: "Unknown",
    stack: [],
    primaryLanguage: "Unknown",
  };

  try {
    // Project name from projects table
    const project = await db.get<{ name: string; path: string }>(
      `SELECT name, path FROM projects WHERE id = ?`,
      [projectId],
    );
    if (project) {
      result.name = project.name;
    }

    // Stack from developer_profile
    const profile = await db.all<{ key: string; value: string }>(
      `SELECT key, value FROM developer_profile
       WHERE project_id = ? AND key IN ('preferred_stack', 'primary_language', 'project_type')
       AND confidence >= 0.5`,
      [projectId],
    );
    for (const p of profile) {
      if (p.key === "preferred_stack") {
        try {
          result.stack = JSON.parse(p.value);
        } catch {
          result.stack = [p.value];
        }
      }
      if (p.key === "primary_language") result.primaryLanguage = p.value;
      if (p.key === "project_type") result.type = p.value;
    }

    // Infer from file extensions if no profile data
    if (result.primaryLanguage === "Unknown") {
      const extensions = await db.all<{ ext: string; cnt: number }>(
        `SELECT
           CASE
             WHEN path LIKE '%.ts' OR path LIKE '%.tsx' THEN 'TypeScript'
             WHEN path LIKE '%.js' OR path LIKE '%.jsx' THEN 'JavaScript'
             WHEN path LIKE '%.py' THEN 'Python'
             WHEN path LIKE '%.go' THEN 'Go'
             WHEN path LIKE '%.rs' THEN 'Rust'
             ELSE 'Other'
           END as ext,
           COUNT(*) as cnt
         FROM files WHERE project_id = ? AND archived_at IS NULL
         GROUP BY ext ORDER BY cnt DESC LIMIT 1`,
        [projectId],
      );
      if (extensions.length > 0) {
        result.primaryLanguage = extensions[0].ext;
      }
    }
  } catch {
    // Tables may not exist
  }

  return result;
}

async function collectArchitecture(
  db: DatabaseAdapter,
  projectId: number,
): Promise<CodebaseDNA["architecture"]> {
  const result: CodebaseDNA["architecture"] = {
    patterns: [],
    entryPoints: [],
    keyAbstractions: [],
  };

  try {
    // Entry points: files with high fragility that are entry-like
    const entries = await db.all<{ path: string }>(
      `SELECT path FROM files
       WHERE project_id = ? AND archived_at IS NULL
       AND (type IN ('entry', 'config', 'server') OR path LIKE '%/index.%' OR path LIKE '%/main.%' OR path LIKE '%/server.%' OR path LIKE '%/app.%')
       ORDER BY fragility DESC LIMIT 5`,
      [projectId],
    );
    result.entryPoints = entries.map((e) => e.path);

    // Key abstractions from high-confidence decisions
    const decisions = await db.all<{ title: string }>(
      `SELECT title FROM decisions
       WHERE project_id = ? AND archived_at IS NULL AND confidence >= 7
       AND outcome NOT IN ('failed')
       ORDER BY confidence DESC LIMIT 5`,
      [projectId],
    );
    result.keyAbstractions = decisions.map((d) => d.title);

    // Patterns from learnings of type 'pattern'
    const patterns = await db.all<{ title: string }>(
      `SELECT title FROM learnings
       WHERE project_id = ? AND archived_at IS NULL
       AND category = 'pattern' AND confidence >= 6
       ORDER BY confidence DESC LIMIT 5`,
      [projectId],
    );
    result.patterns = patterns.map((p) => p.title);
  } catch {
    // Tables may not exist
  }

  return result;
}

async function collectConventions(
  db: DatabaseAdapter,
  projectId: number,
): Promise<CodebaseDNA["conventions"]> {
  const result: CodebaseDNA["conventions"] = {
    naming: "",
    fileOrg: "",
    errorHandling: "",
    testing: "",
  };

  try {
    // Convention learnings
    const conventions = await db.all<{ title: string; content: string }>(
      `SELECT title, content FROM learnings
       WHERE project_id = ? AND archived_at IS NULL
       AND category = 'convention' AND confidence >= 5
       ORDER BY confidence DESC LIMIT 4`,
      [projectId],
    );

    for (const c of conventions) {
      const titleLower = c.title.toLowerCase();
      if (titleLower.includes("naming") || titleLower.includes("name")) {
        result.naming = c.content.slice(0, 80);
      } else if (titleLower.includes("file") || titleLower.includes("organiz") || titleLower.includes("structure")) {
        result.fileOrg = c.content.slice(0, 80);
      } else if (titleLower.includes("error") || titleLower.includes("exception")) {
        result.errorHandling = c.content.slice(0, 80);
      } else if (titleLower.includes("test")) {
        result.testing = c.content.slice(0, 80);
      }
    }

    // Profile-based conventions
    const profileConventions = await db.all<{ key: string; value: string }>(
      `SELECT key, value FROM developer_profile
       WHERE project_id = ? AND key LIKE 'convention_%' AND confidence >= 0.5`,
      [projectId],
    );
    for (const p of profileConventions) {
      if (p.key === "convention_naming" && !result.naming) result.naming = p.value;
      if (p.key === "convention_testing" && !result.testing) result.testing = p.value;
    }
  } catch {
    // Tables may not exist
  }

  return result;
}

async function collectDangerZones(
  db: DatabaseAdapter,
  projectId: number,
): Promise<CodebaseDNA["dangerZones"]> {
  const result: CodebaseDNA["dangerZones"] = {
    fragileFiles: [],
    knownPitfalls: [],
    criticalPaths: [],
  };

  try {
    // Fragile files
    const fragile = await db.all<{ path: string; fragility: number }>(
      `SELECT path, fragility FROM files
       WHERE project_id = ? AND fragility >= 7 AND archived_at IS NULL
       ORDER BY fragility DESC LIMIT 10`,
      [projectId],
    );
    result.fragileFiles = fragile;

    // Known pitfalls (gotcha learnings)
    const gotchas = await db.all<{ title: string }>(
      `SELECT title FROM learnings
       WHERE project_id = ? AND archived_at IS NULL
       AND category = 'gotcha' AND confidence >= 5
       ORDER BY confidence DESC LIMIT 5`,
      [projectId],
    );
    result.knownPitfalls = gotchas.map((g) => g.title);

    // Critical paths: files with highest blast radius
    const critical = await db.all<{ file_path: string }>(
      `SELECT file_path FROM blast_summary
       WHERE project_id = ?
       ORDER BY total_score DESC LIMIT 5`,
      [projectId],
    );
    result.criticalPaths = critical.map((c) => c.file_path);
  } catch {
    // Tables may not exist
  }

  return result;
}

async function collectTeamKnowledge(
  db: DatabaseAdapter,
  projectId: number,
): Promise<CodebaseDNA["teamKnowledge"]> {
  const result: CodebaseDNA["teamKnowledge"] = {
    topLearnings: [],
    failedDecisions: [],
    activeIssues: [],
  };

  try {
    // Top learnings by confidence
    const learnings = await db.all<{ title: string }>(
      `SELECT title FROM learnings
       WHERE project_id = ? AND archived_at IS NULL AND confidence >= 7
       ORDER BY confidence DESC, times_applied DESC LIMIT 5`,
      [projectId],
    );
    result.topLearnings = learnings.map((l) => l.title);

    // Failed decisions
    const failed = await db.all<{ title: string }>(
      `SELECT title FROM decisions
       WHERE project_id = ? AND outcome = 'failed' AND archived_at IS NULL
       ORDER BY updated_at DESC LIMIT 3`,
      [projectId],
    );
    result.failedDecisions = failed.map((d) => d.title);

    // Active issues
    const issues = await db.all<{ title: string }>(
      `SELECT title FROM issues
       WHERE project_id = ? AND status = 'open'
       ORDER BY severity DESC LIMIT 5`,
      [projectId],
    );
    result.activeIssues = issues.map((i) => i.title);
  } catch {
    // Tables may not exist
  }

  return result;
}

async function getSessionCount(
  db: DatabaseAdapter,
  projectId: number,
): Promise<number> {
  try {
    const result = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?`,
      [projectId],
    );
    return result?.cnt ?? 0;
  } catch {
    return 0;
  }
}
