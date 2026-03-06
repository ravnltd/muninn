/**
 * v9 Recall — The Only Retrieval Tool
 *
 * Unifies query, predict, suggest, check, context, and enrich
 * into a single tool that auto-detects intent from input shape.
 *
 * Input shapes:
 *   { files: [...] }  → Pre-edit mode (fragility, co-changers, decisions, issues, blast)
 *   { query: "..." }  → Search mode (hybrid FTS+vector across all tables)
 *   { task: "..." }   → Planning mode (related files, decisions, learnings, issues, advisory)
 */

import type { DatabaseAdapter } from "../database/adapter.js";


// ============================================================================
// Types
// ============================================================================

interface RecallFileResult {
  path: string;
  fragility: number;
  purpose: string | null;
  type: string | null;
  isStale: boolean;
  cochangers: Array<{ file: string; count: number }>;
  decisions: Array<{ id: number; title: string }>;
  issues: Array<{ id: number; title: string; severity: number }>;
  learnings: Array<{ title: string; content: string; category: string | null; confidence: number }>;
  blastRadius: { score: number; direct: number; transitive: number; tests: number; risk: string } | null;
  warnings: string[];
}

interface RecallSearchResult {
  type: "decision" | "learning" | "issue" | "file";
  id: number;
  title: string;
  content: string | null;
  confidence: number;
}

interface RecallResult {
  mode: "files" | "search" | "plan";
  files: RecallFileResult[];
  results: RecallSearchResult[];
  relatedFiles: Array<{ path: string; reason: string; similarity: number }>;
  warnings: string[];
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function recall(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  input: { files?: string[]; query?: string; task?: string },
): Promise<RecallResult> {
  // Auto-detect mode from input shape
  if (input.files && input.files.length > 0) {
    return recallFiles(db, projectId, cwd, input.files);
  }
  if (input.query) {
    return recallSearch(db, projectId, input.query);
  }
  if (input.task) {
    return recallPlan(db, projectId, input.task);
  }

  return {
    mode: "search",
    files: [],
    results: [],
    relatedFiles: [],
    warnings: ["Provide files, query, or task"],
  };
}

// ============================================================================
// Mode: Files (Pre-Edit)
// ============================================================================

async function recallFiles(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  files: string[],
): Promise<RecallResult> {
  const fileResults = await Promise.all(
    files.map((f) => recallSingleFile(db, projectId, cwd, f)),
  );

  // Collect global warnings
  const warnings: string[] = [];
  for (const f of fileResults) {
    if (f.fragility >= 8) {
      warnings.push(`HIGH FRAGILITY: ${f.path} (${f.fragility}/10) — explain approach before editing`);
    }
    if (f.isStale) {
      warnings.push(`STALE: ${f.path} changed since last analysis`);
    }
  }

  // Ambient intelligence: surface proactive warnings
  const ambient = await detectAmbientWarnings(db, projectId, files);
  warnings.push(...ambient);

  return {
    mode: "files",
    files: fileResults,
    results: [],
    relatedFiles: [],
    warnings,
  };
}

async function recallSingleFile(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  filePath: string,
): Promise<RecallFileResult> {
  // Run all queries in parallel
  const [fileRecord, relatedIssues, relatedDecisions, correlations, learnings, blastData] =
    await Promise.all([
      // 1. File metadata + fragility
      db.get<{
        id: number;
        fragility: number;
        fragility_reason: string | null;
        content_hash: string | null;
        purpose: string | null;
        type: string | null;
        dependents: string | null;
      }>(
        `SELECT id, fragility, fragility_reason, content_hash, purpose, type, dependents
         FROM files WHERE project_id = ? AND path = ?`,
        [projectId, filePath],
      ).catch(() => null),

      // 2. Open issues affecting this file
      db.all<{ id: number; title: string; severity: number }>(
        `SELECT id, title, severity FROM issues
         WHERE project_id = ? AND status = 'open'
         AND affected_files LIKE ?
         ORDER BY severity DESC LIMIT 5`,
        [projectId, `%${filePath}%`],
      ).catch(() => []),

      // 3. Active decisions affecting this file
      db.all<{ id: number; title: string }>(
        `SELECT id, title FROM decisions
         WHERE project_id = ? AND status = 'active' AND affects LIKE ?
         LIMIT 5`,
        [projectId, `%${filePath}%`],
      ).catch(() => []),

      // 4. Co-changing files
      getCorrelatedFiles(db, projectId, filePath, 5),

      // 5. Related learnings (search content and context — files column may not exist in all schemas)
      db.all<{ title: string; content: string; category: string | null; confidence: number }>(
        `SELECT title, content, category, confidence FROM learnings
         WHERE project_id = ? AND (content LIKE ? OR context LIKE ?)
         ORDER BY confidence DESC LIMIT 3`,
        [projectId, `%${filePath}%`, `%${filePath}%`],
      ).catch(() => []),

      // 6. Blast radius
      db.get<{
        blast_score: number;
        direct_dependents: number;
        transitive_dependents: number;
        affected_tests: number;
      }>(
        `SELECT blast_score, direct_dependents, transitive_dependents, affected_tests
         FROM blast_summary WHERE project_id = ? AND file_path = ?`,
        [projectId, filePath],
      ).catch(() => null),
    ]);

  // Check staleness
  let isStale = false;
  if (fileRecord?.content_hash) {
    try {
      const { existsSync, readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const fullPath = filePath.startsWith("/") ? filePath : resolve(cwd, filePath);
      if (existsSync(fullPath)) {
        const { computeContentHash } = await import("../utils/format.js");
        const content = readFileSync(fullPath, "utf-8");
        const currentHash = computeContentHash(content);
        isStale = currentHash !== fileRecord.content_hash;
      }
    } catch {
      // Skip staleness check
    }
  }

  // Build warnings
  const warnings: string[] = [];
  if (fileRecord && fileRecord.fragility >= 8) {
    warnings.push(`HIGH FRAGILITY (${fileRecord.fragility}/10)`);
    if (fileRecord.fragility_reason) warnings.push(fileRecord.fragility_reason);
  }
  if (isStale) warnings.push("File changed since last analysis");
  if (relatedIssues.length > 0) warnings.push(`${relatedIssues.length} open issue(s)`);

  const blastRadius = blastData
    ? {
        score: blastData.blast_score,
        direct: blastData.direct_dependents,
        transitive: blastData.transitive_dependents,
        tests: blastData.affected_tests,
        risk: blastData.blast_score >= 75 ? "critical" :
              blastData.blast_score >= 50 ? "high" :
              blastData.blast_score >= 25 ? "medium" : "low",
      }
    : null;

  return {
    path: filePath,
    fragility: fileRecord?.fragility ?? 0,
    purpose: fileRecord?.purpose ?? null,
    type: fileRecord?.type ?? null,
    isStale,
    cochangers: correlations,
    decisions: relatedDecisions,
    issues: relatedIssues,
    learnings,
    blastRadius,
    warnings,
  };
}

// ============================================================================
// Mode: Search
// ============================================================================

async function recallSearch(
  db: DatabaseAdapter,
  projectId: number,
  query: string,
): Promise<RecallResult> {
  // Run FTS and vector search in parallel
  const [ftsResults, vectorResults] = await Promise.all([
    searchFts(db, projectId, query),
    searchVector(db, projectId, query),
  ]);

  // Merge results: vector takes priority, deduplicate by type+id
  const seen = new Set<string>();
  const merged: RecallSearchResult[] = [];

  // Vector results first (higher quality)
  for (const r of vectorResults) {
    const key = `${r.type}:${r.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  // FTS results fill in gaps
  for (const r of ftsResults) {
    const key = `${r.type}:${r.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      // Boost if also found in vector
      merged.push(r);
    }
  }

  return {
    mode: "search",
    files: [],
    results: merged.slice(0, 15),
    relatedFiles: [],
    warnings: merged.length === 0 ? ["No results found"] : [],
  };
}

async function searchFts(
  db: DatabaseAdapter,
  projectId: number,
  query: string,
): Promise<RecallSearchResult[]> {
  const escapedQuery = escapeFtsQuery(query);
  if (!escapedQuery) return [];

  const results: RecallSearchResult[] = [];

  // Search all FTS tables in parallel
  const [decisions, learnings, issues, files] = await Promise.all([
    db.all<{ id: number; title: string; decision: string }>(
      `SELECT d.id, d.title, d.decision FROM fts_decisions
       JOIN decisions d ON fts_decisions.rowid = d.id
       WHERE fts_decisions MATCH ?1 AND d.project_id = ?2 AND d.status = 'active'
       ORDER BY bm25(fts_decisions) LIMIT 5`,
      [escapedQuery, projectId],
    ).catch(() => []),

    db.all<{ id: number; title: string; content: string; confidence: number }>(
      `SELECT l.id, l.title, l.content, l.confidence FROM fts_learnings
       JOIN learnings l ON fts_learnings.rowid = l.id
       WHERE fts_learnings MATCH ?1 AND (l.project_id = ?2 OR l.project_id IS NULL)
       ORDER BY bm25(fts_learnings) LIMIT 5`,
      [escapedQuery, projectId],
    ).catch(() => []),

    db.all<{ id: number; title: string; severity: number }>(
      `SELECT i.id, i.title, i.severity FROM fts_issues
       JOIN issues i ON fts_issues.rowid = i.id
       WHERE fts_issues MATCH ?1 AND i.project_id = ?2 AND i.status = 'open'
       ORDER BY i.severity DESC LIMIT 3`,
      [escapedQuery, projectId],
    ).catch(() => []),

    db.all<{ id: number; path: string; purpose: string | null }>(
      `SELECT f.id, f.path as title, f.purpose FROM fts_files
       JOIN files f ON fts_files.rowid = f.id
       WHERE fts_files MATCH ?1 AND f.project_id = ?2
       ORDER BY bm25(fts_files) LIMIT 5`,
      [escapedQuery, projectId],
    ).catch(() => []),
  ]);

  for (const d of decisions) {
    results.push({ type: "decision", id: d.id, title: d.title, content: d.decision, confidence: 0.7 });
  }
  for (const l of learnings) {
    results.push({ type: "learning", id: l.id, title: l.title, content: l.content, confidence: l.confidence / 10 });
  }
  for (const i of issues) {
    results.push({ type: "issue", id: i.id, title: i.title, content: null, confidence: i.severity / 10 });
  }
  for (const f of files) {
    results.push({ type: "file", id: f.id, title: f.path, content: f.purpose, confidence: 0.5 });
  }

  return results;
}

async function searchVector(
  db: DatabaseAdapter,
  projectId: number,
  query: string,
): Promise<RecallSearchResult[]> {
  try {
    const { vectorSearch } = await import("../database/queries/vector.js");
    const vResults = await vectorSearch(db, query, projectId, {
      limit: 10,
      minSimilarity: 0.35,
      tables: ["decisions", "learnings", "issues", "files"],
    });

    return vResults.map((r) => ({
      type: r.type as RecallSearchResult["type"],
      id: r.id,
      title: r.title,
      content: r.content,
      confidence: r.similarity,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// Mode: Plan (Task)
// ============================================================================

async function recallPlan(
  db: DatabaseAdapter,
  projectId: number,
  task: string,
): Promise<RecallResult> {
  // Run all searches in parallel
  const [ftsResults, vectorFileResults, vectorKnowledgeResults] = await Promise.all([
    searchFts(db, projectId, task),
    searchVectorFiles(db, projectId, task),
    searchVector(db, projectId, task),
  ]);

  // Merge knowledge results
  const seen = new Set<string>();
  const results: RecallSearchResult[] = [];

  for (const r of vectorKnowledgeResults) {
    const key = `${r.type}:${r.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(r);
    }
  }
  for (const r of ftsResults) {
    const key = `${r.type}:${r.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(r);
    }
  }

  // Get co-changers for top suggested files
  const topFiles = vectorFileResults.slice(0, 3).map((f) => f.path);
  const cochangers: Array<{ path: string; reason: string; similarity: number }> = [];
  if (topFiles.length > 0) {
    const cochangeResults = await Promise.all(
      topFiles.map((f) => getCorrelatedFiles(db, projectId, f, 3)),
    );
    const cochangeSeen = new Set(topFiles);
    for (const group of cochangeResults) {
      for (const c of group) {
        if (!cochangeSeen.has(c.file)) {
          cochangeSeen.add(c.file);
          cochangers.push({ path: c.file, reason: `co-changes (${c.count}x)`, similarity: 0 });
        }
      }
    }
  }

  return {
    mode: "plan",
    files: [],
    results: results.slice(0, 15),
    relatedFiles: [...vectorFileResults, ...cochangers].slice(0, 10),
    warnings: [],
  };
}

async function searchVectorFiles(
  db: DatabaseAdapter,
  projectId: number,
  task: string,
): Promise<Array<{ path: string; reason: string; similarity: number }>> {
  try {
    const { vectorSearch } = await import("../database/queries/vector.js");
    const vResults = await vectorSearch(db, task, projectId, {
      limit: 8,
      minSimilarity: 0.3,
      tables: ["files"],
    });

    return vResults.map((r) => ({
      path: r.title,
      reason: r.content?.slice(0, 60) ?? "semantically related",
      similarity: Math.round(r.similarity * 100) / 100,
    }));
  } catch {
    // Fallback to FTS
    try {
      const escaped = escapeFtsQuery(task);
      if (!escaped) return [];

      const files = await db.all<{ path: string; purpose: string | null }>(
        `SELECT f.path, f.purpose FROM fts_files
         JOIN files f ON fts_files.rowid = f.id
         WHERE fts_files MATCH ?1 AND f.project_id = ?2
         ORDER BY bm25(fts_files) LIMIT 8`,
        [escaped, projectId],
      );

      return files.map((f, i) => ({
        path: f.path,
        reason: f.purpose?.slice(0, 60) ?? "keyword match",
        similarity: Math.max(0.3, 0.8 - i * 0.1),
      }));
    } catch {
      return [];
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function getCorrelatedFiles(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string,
  limit: number,
): Promise<Array<{ file: string; count: number }>> {
  try {
    const results = await db.all<{ correlated: string; cochange_count: number }>(
      `SELECT CASE WHEN file_a = ?2 THEN file_b ELSE file_a END as correlated,
              cochange_count
       FROM file_correlations
       WHERE project_id = ?1 AND (file_a = ?2 OR file_b = ?2)
       ORDER BY cochange_count DESC LIMIT ?3`,
      [projectId, filePath, limit],
    );
    return results.map((r) => ({ file: r.correlated, count: r.cochange_count }));
  } catch {
    return [];
  }
}

// ============================================================================
// Ambient Intelligence — Proactive Warnings
// ============================================================================

async function detectAmbientWarnings(
  db: DatabaseAdapter,
  projectId: number,
  files: string[],
): Promise<string[]> {
  const warnings: string[] = [];

  try {
    const [recentErrors, unresolvedIssues, driftedDecisions] = await Promise.all([
      // Recent errors on these files
      db.all<{ file_path: string; error_type: string; message: string }>(
        `SELECT file_path, error_type, message FROM error_events
         WHERE project_id = ? AND file_path IN (${files.map(() => "?").join(",")})
         AND created_at > datetime('now', '-7 days')
         ORDER BY created_at DESC LIMIT 3`,
        [projectId, ...files],
      ).catch(() => []),

      // High-severity unresolved issues on these files
      db.all<{ title: string; severity: number }>(
        `SELECT title, severity FROM issues
         WHERE project_id = ? AND status = 'open' AND severity >= 7
         AND (${files.map(() => "affected_files LIKE ?").join(" OR ")})
         LIMIT 3`,
        [projectId, ...files.map((f) => `%${f}%`)],
      ).catch(() => []),

      // Decisions that haven't been reviewed and affect these files
      db.all<{ title: string; sessions_since: number }>(
        `SELECT title, sessions_since FROM decisions
         WHERE project_id = ? AND status = 'active'
         AND outcome_status = 'pending'
         AND sessions_since >= check_after_sessions
         AND (${files.map(() => "affects LIKE ?").join(" OR ")})
         LIMIT 3`,
        [projectId, ...files.map((f) => `%${f}%`)],
      ).catch(() => []),
    ]);

    for (const err of recentErrors) {
      warnings.push(`RECENT ERROR: ${err.file_path} — ${err.error_type}: ${err.message.slice(0, 60)}`);
    }

    for (const issue of unresolvedIssues) {
      warnings.push(`CRITICAL ISSUE: ${issue.title} (sev:${issue.severity}) — resolve before editing`);
    }

    for (const dec of driftedDecisions) {
      warnings.push(`DECISION REVIEW DUE: "${dec.title}" — ${dec.sessions_since} sessions without review`);
    }
  } catch {
    // Non-critical — don't break recall
  }

  return warnings;
}

function escapeFtsQuery(query: string): string {
  // Remove FTS operators and wrap each word in quotes
  const stopWords = new Set(["and", "or", "not", "near"]);
  const words = query
    .replace(/[`$(){}|;&<>\\]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !stopWords.has(w.toLowerCase()));

  if (words.length === 0) return "";

  return words.map((w) => `"${w}"`).join(" ");
}

// ============================================================================
// Formatter
// ============================================================================

export function formatRecallResult(result: RecallResult): string {
  const sections: string[] = [];

  // Warnings first
  if (result.warnings.length > 0) {
    sections.push("WARNINGS:\n" + result.warnings.map((w) => `  ! ${w}`).join("\n"));
  }

  // Files mode
  if (result.mode === "files") {
    for (const f of result.files) {
      const parts = [f.path];
      if (f.fragility > 0) parts.push(`frag:${f.fragility}`);
      if (f.type) parts.push(f.type);
      if (f.purpose) parts.push(f.purpose.slice(0, 50));
      sections.push(`F[${parts.join("|")}]`);

      if (f.cochangers.length > 0) {
        sections.push(`  co-changes: ${f.cochangers.map((c) => `${c.file} (${c.count}x)`).join(", ")}`);
      }

      for (const d of f.decisions) {
        sections.push(`  D[${d.title.slice(0, 60)}]`);
      }

      for (const i of f.issues) {
        sections.push(`  I[#${i.id}|sev:${i.severity}|${i.title.slice(0, 40)}]`);
      }

      for (const l of f.learnings) {
        const cat = l.category ? `${l.category}|` : "";
        sections.push(`  K[${cat}${l.title.slice(0, 50)}|conf:${l.confidence}]`);
      }

      if (f.blastRadius) {
        const b = f.blastRadius;
        sections.push(`  B[score:${b.score}|direct:${b.direct}|trans:${b.transitive}|tests:${b.tests}|risk:${b.risk}]`);
      }
    }
  }

  // Search/plan results
  if (result.results.length > 0) {
    const decisions = result.results.filter((r) => r.type === "decision");
    const learnings = result.results.filter((r) => r.type === "learning");
    const issues = result.results.filter((r) => r.type === "issue");
    const files = result.results.filter((r) => r.type === "file");

    if (decisions.length > 0) {
      for (const d of decisions) {
        const conf = Math.round(d.confidence * 100);
        sections.push(`D[${d.title.slice(0, 60)}|${conf}%]`);
        if (d.content) sections.push(`  ${d.content.slice(0, 80)}`);
      }
    }

    if (learnings.length > 0) {
      for (const l of learnings) {
        const conf = Math.round(l.confidence * 100);
        sections.push(`K[${l.title.slice(0, 60)}|conf:${conf}%]`);
        if (l.content) sections.push(`  ${l.content.slice(0, 80)}`);
      }
    }

    if (issues.length > 0) {
      for (const i of issues) {
        sections.push(`I[#${i.id}|${i.title.slice(0, 50)}]`);
      }
    }

    if (files.length > 0) {
      for (const f of files) {
        sections.push(`F[${f.title}|${f.content?.slice(0, 40) ?? ""}]`);
      }
    }
  }

  // Related files (plan mode)
  if (result.relatedFiles.length > 0) {
    sections.push("RELATED FILES:");
    for (const f of result.relatedFiles) {
      const sim = f.similarity > 0 ? ` (${Math.round(f.similarity * 100)}%)` : "";
      sections.push(`  ${f.path}${sim} — ${f.reason}`);
    }
  }

  if (sections.length === 0) {
    return "No relevant context found.";
  }

  return sections.join("\n");
}
