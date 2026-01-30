/**
 * Search and FTS queries
 * Full-text search and semantic query functionality
 * Fixes SQL injection by using parameterized queries
 */

import type { DatabaseAdapter } from "../adapter";
import { isEmbeddingAvailable } from "../../embeddings";
import type { GlobalLearning, Pattern, QueryResult } from "../../types";
import { logError } from "../../utils/errors";
import { hasEmbeddings, hybridSearch as vectorHybridSearch } from "./vector";
import { validateTableName } from "./utils";

// ============================================================================
// FTS5 Query Escaping
// ============================================================================

/**
 * Escape FTS5 special characters to prevent query injection.
 * FTS5 operators: AND, OR, NOT, NEAR, *, ", ^
 */
export function escapeFtsQuery(query: string): string {
  // Remove FTS operators and wildcards
  const sanitized = query
    .replace(/["*^]/g, " ") // Remove special chars
    .trim()
    .slice(0, 200); // Limit length

  if (!sanitized) return '""';

  // Split into terms, filter operators, wrap in quotes
  return sanitized
    .split(/\s+/)
    .filter((term) => !["OR", "AND", "NOT", "NEAR"].includes(term.toUpperCase()))
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" ");
}

// ============================================================================
// Focus & Temperature Integration
// ============================================================================

interface FocusContext {
  area: string;
  files: string[];
  keywords: string[];
}

/**
 * Get active focus for a project (if any)
 */
async function getActiveFocus(db: DatabaseAdapter, projectId: number): Promise<FocusContext | null> {
  try {
    const focus = await db.get<{
      area: string;
      files: string | null;
      keywords: string | null;
    }>(
      `SELECT area, files, keywords FROM focus
      WHERE project_id = ? AND cleared_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );

    if (!focus) return null;

    return {
      area: focus.area,
      files: focus.files ? JSON.parse(focus.files) : [],
      keywords: focus.keywords ? JSON.parse(focus.keywords) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Apply focus boost to search results
 * Additive: nudges ranking without completely overriding relevance
 */
function applyFocusBoost(results: QueryResult[], focus: FocusContext): QueryResult[] {
  if (!focus || (focus.keywords.length === 0 && focus.files.length === 0)) {
    return results;
  }

  return results
    .map((r) => {
      let boost = 0;

      // Keyword matching in title/content
      for (const keyword of focus.keywords) {
        const kw = keyword.toLowerCase();
        if (r.title.toLowerCase().includes(kw)) boost += 0.3;
        if (r.content?.toLowerCase().includes(kw)) boost += 0.2;
      }

      // File pattern matching for file results
      if (r.type === "file") {
        for (const pattern of focus.files) {
          const pat = pattern.replace(/\*/g, "");
          if (r.title.includes(pat)) boost += 0.4;
        }
      }

      // Cap boost at 1.0
      return { ...r, relevance: r.relevance - Math.min(boost, 1.0) }; // Lower = better for bm25
    })
    .sort((a, b) => a.relevance - b.relevance);
}

/**
 * Heat entities that appear in query results
 */
async function heatQueryResults(db: DatabaseAdapter, results: QueryResult[]): Promise<void> {
  const tableMap: Record<string, string> = {
    file: "files",
    decision: "decisions",
    issue: "issues",
    learning: "learnings",
  };

  for (const result of results.slice(0, 5)) {
    // Only heat top 5
    const table = tableMap[result.type];
    if (table) {
      try {
        // Validate table name to prevent SQL injection
        const validTable = validateTableName(table);
        await db.run(
          `UPDATE ${validTable}
          SET temperature = 'hot', last_referenced_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [result.id]
        );
      } catch {
        // Temperature columns might not exist or table validation failed
      }
    }
  }
}

// ============================================================================
// Semantic Query (Fixed - Parameterized)
// ============================================================================

interface FileSearchResult {
  id: number;
  title: string;
  content: string | null;
  relevance: number;
}

interface DecisionSearchResult {
  id: number;
  title: string;
  content: string;
  relevance: number;
  native_format?: string | null;
}

interface IssueSearchResult {
  id: number;
  title: string;
  content: string | null;
  relevance: number;
}

interface LearningSearchResult {
  id: number;
  title: string;
  content: string;
  relevance: number;
  native_format?: string | null;
}

/**
 * Perform semantic search across all knowledge
 * Uses parameterized queries to prevent SQL injection
 * Supports hybrid search (FTS + vector) when embeddings are available
 */
export async function semanticQuery(
  db: DatabaseAdapter,
  query: string,
  projectId?: number,
  options?: { mode?: "auto" | "fts" | "vector" | "hybrid" }
): Promise<QueryResult[]> {
  const mode = options?.mode ?? "auto";

  // Determine if we should use hybrid/vector search
  const hasProjectEmbeddings = projectId ? await hasEmbeddings(db, projectId) : false;
  const useVectorSearch =
    mode === "vector" ||
    mode === "hybrid" ||
    (mode === "auto" && isEmbeddingAvailable() && projectId && hasProjectEmbeddings);

  // If vector mode or hybrid mode with embeddings available, try vector search first
  if (useVectorSearch && projectId) {
    try {
      const vectorResults = await vectorHybridSearch(db, query, projectId);
      if (vectorResults.length > 0) {
        // Merge with FTS results for hybrid mode
        if (mode === "hybrid" || mode === "auto") {
          const ftsResults = await ftsOnlyQuery(db, query, projectId);
          return mergeResults(vectorResults, ftsResults);
        }
        return vectorResults;
      }
    } catch (error) {
      logError("semanticQuery:vector", error);
      // Fall through to FTS
    }
  }

  // Fall back to FTS-only
  let results = await ftsOnlyQuery(db, query, projectId);

  // Apply focus boost if project context exists
  if (projectId) {
    const focus = await getActiveFocus(db, projectId);
    if (focus) {
      results = applyFocusBoost(results, focus);
    }

    // Heat top results
    await heatQueryResults(db, results);
  }

  return results;
}

/**
 * FTS-only query (original semanticQuery implementation)
 */
async function ftsOnlyQuery(db: DatabaseAdapter, query: string, projectId?: number): Promise<QueryResult[]> {
  const results: QueryResult[] = [];

  // Escape the query to prevent FTS5 injection
  const safeQuery = escapeFtsQuery(query);
  if (!safeQuery || safeQuery === '""') return results;

  // Search files
  try {
    const files = projectId
      ? await db.all<FileSearchResult>(
          `SELECT f.id, f.path as title, f.purpose as content,
                 bm25(fts_files) as relevance
          FROM fts_files
          JOIN files f ON fts_files.rowid = f.id
          WHERE fts_files MATCH ?1 AND f.project_id = ?2 AND f.archived_at IS NULL
          ORDER BY relevance
          LIMIT 5`,
          [safeQuery, projectId]
        )
      : await db.all<FileSearchResult>(
          `SELECT f.id, f.path as title, f.purpose as content,
                 bm25(fts_files) as relevance
          FROM fts_files
          JOIN files f ON fts_files.rowid = f.id
          WHERE fts_files MATCH ?1 AND f.archived_at IS NULL
          ORDER BY relevance
          LIMIT 5`,
          [safeQuery]
        );

    results.push(
      ...files.map((f) => ({
        type: "file" as const,
        id: f.id,
        title: f.title,
        content: f.content,
        relevance: f.relevance,
      }))
    );
  } catch (error) {
    logError("semanticQuery:files", error);
  }

  // Search decisions (with native format when available)
  try {
    let decisions: DecisionSearchResult[];
    try {
      decisions = projectId
        ? await db.all<DecisionSearchResult>(
            `SELECT d.id, d.title, d.decision as content, nk.native_format,
                   bm25(fts_decisions) as relevance
            FROM fts_decisions
            JOIN decisions d ON fts_decisions.rowid = d.id
            LEFT JOIN native_knowledge nk ON nk.source_table = 'decisions' AND nk.source_id = d.id
            WHERE fts_decisions MATCH ?1 AND d.project_id = ?2 AND d.archived_at IS NULL
            ORDER BY relevance
            LIMIT 5`,
            [safeQuery, projectId]
          )
        : await db.all<DecisionSearchResult>(
            `SELECT d.id, d.title, d.decision as content, nk.native_format,
                   bm25(fts_decisions) as relevance
            FROM fts_decisions
            JOIN decisions d ON fts_decisions.rowid = d.id
            LEFT JOIN native_knowledge nk ON nk.source_table = 'decisions' AND nk.source_id = d.id
            WHERE fts_decisions MATCH ?1 AND d.archived_at IS NULL
            ORDER BY relevance
            LIMIT 5`,
            [safeQuery]
          );
    } catch {
      // Fallback if native_knowledge table doesn't exist
      decisions = projectId
        ? await db.all<DecisionSearchResult>(
            `SELECT d.id, d.title, d.decision as content,
                   bm25(fts_decisions) as relevance
            FROM fts_decisions
            JOIN decisions d ON fts_decisions.rowid = d.id
            WHERE fts_decisions MATCH ?1 AND d.project_id = ?2 AND d.archived_at IS NULL
            ORDER BY relevance
            LIMIT 5`,
            [safeQuery, projectId]
          )
        : await db.all<DecisionSearchResult>(
            `SELECT d.id, d.title, d.decision as content,
                   bm25(fts_decisions) as relevance
            FROM fts_decisions
            JOIN decisions d ON fts_decisions.rowid = d.id
            WHERE fts_decisions MATCH ?1 AND d.archived_at IS NULL
            ORDER BY relevance
            LIMIT 5`,
            [safeQuery]
          );
    }

    results.push(
      ...decisions.map((d) => ({
        type: "decision" as const,
        id: d.id,
        title: d.title,
        // Use native format when available, fall back to prose
        content: d.native_format ?? d.content,
        relevance: d.relevance,
      }))
    );
  } catch (error) {
    logError("semanticQuery:decisions", error);
  }

  // Search issues
  try {
    const issues = projectId
      ? await db.all<IssueSearchResult>(
          `SELECT i.id, i.title, i.description as content,
                 bm25(fts_issues) as relevance
          FROM fts_issues
          JOIN issues i ON fts_issues.rowid = i.id
          WHERE fts_issues MATCH ?1 AND i.project_id = ?2 AND i.archived_at IS NULL
          ORDER BY relevance
          LIMIT 5`,
          [safeQuery, projectId]
        )
      : await db.all<IssueSearchResult>(
          `SELECT i.id, i.title, i.description as content,
                 bm25(fts_issues) as relevance
          FROM fts_issues
          JOIN issues i ON fts_issues.rowid = i.id
          WHERE fts_issues MATCH ?1 AND i.archived_at IS NULL
          ORDER BY relevance
          LIMIT 5`,
          [safeQuery]
        );

    results.push(
      ...issues.map((i) => ({
        type: "issue" as const,
        id: i.id,
        title: i.title,
        content: i.content,
        relevance: i.relevance,
      }))
    );
  } catch (error) {
    logError("semanticQuery:issues", error);
  }

  // Search learnings (with native format when available)
  try {
    // Try with native_knowledge join first
    let learnings: LearningSearchResult[];
    try {
      learnings = projectId
        ? await db.all<LearningSearchResult>(
            `SELECT l.id, l.title, l.content, nk.native_format,
                   bm25(fts_learnings) as relevance
            FROM fts_learnings
            JOIN learnings l ON fts_learnings.rowid = l.id
            LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
            WHERE fts_learnings MATCH ?1 AND (l.project_id = ?2 OR l.project_id IS NULL) AND l.archived_at IS NULL
            ORDER BY relevance
            LIMIT 5`,
            [safeQuery, projectId]
          )
        : await db.all<LearningSearchResult>(
            `SELECT l.id, l.title, l.content, nk.native_format,
                   bm25(fts_learnings) as relevance
            FROM fts_learnings
            JOIN learnings l ON fts_learnings.rowid = l.id
            LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
            WHERE fts_learnings MATCH ?1 AND l.archived_at IS NULL
            ORDER BY relevance
            LIMIT 5`,
            [safeQuery]
          );
    } catch {
      // Fallback if native_knowledge table doesn't exist
      learnings = projectId
        ? await db.all<LearningSearchResult>(
            `SELECT l.id, l.title, l.content,
                   bm25(fts_learnings) as relevance
            FROM fts_learnings
            JOIN learnings l ON fts_learnings.rowid = l.id
            WHERE fts_learnings MATCH ?1 AND (l.project_id = ?2 OR l.project_id IS NULL) AND l.archived_at IS NULL
            ORDER BY relevance
            LIMIT 5`,
            [safeQuery, projectId]
          )
        : await db.all<LearningSearchResult>(
            `SELECT l.id, l.title, l.content,
                   bm25(fts_learnings) as relevance
            FROM fts_learnings
            JOIN learnings l ON fts_learnings.rowid = l.id
            WHERE fts_learnings MATCH ?1 AND l.archived_at IS NULL
            ORDER BY relevance
            LIMIT 5`,
            [safeQuery]
          );
    }

    results.push(
      ...learnings.map((l) => ({
        type: "learning" as const,
        id: l.id,
        title: l.title,
        // Use native format when available, fall back to prose
        content: l.native_format ?? l.content,
        relevance: l.relevance,
      }))
    );
  } catch (error) {
    logError("semanticQuery:learnings", error);
  }

  // Search symbols (code chunks)
  try {
    type SymbolSearchResult = {
      id: number;
      name: string;
      type: string;
      signature: string;
      purpose: string | null;
      file_path: string;
      relevance: number;
    };

    const symbols = projectId
      ? await db.all<SymbolSearchResult>(
          `SELECT s.id, s.name, s.type, s.signature, s.purpose, f.path as file_path,
                 bm25(fts_symbols) as relevance
          FROM fts_symbols
          JOIN symbols s ON fts_symbols.rowid = s.id
          JOIN files f ON s.file_id = f.id
          WHERE fts_symbols MATCH ?1 AND f.project_id = ?2
          ORDER BY relevance
          LIMIT 10`,
          [safeQuery, projectId]
        )
      : await db.all<SymbolSearchResult>(
          `SELECT s.id, s.name, s.type, s.signature, s.purpose, f.path as file_path,
                 bm25(fts_symbols) as relevance
          FROM fts_symbols
          JOIN symbols s ON fts_symbols.rowid = s.id
          JOIN files f ON s.file_id = f.id
          WHERE fts_symbols MATCH ?1
          ORDER BY relevance
          LIMIT 10`,
          [safeQuery]
        );

    results.push(
      ...symbols.map((s) => ({
        type: "symbol" as const,
        id: s.id,
        title: `${s.name} (${s.type}) in ${s.file_path}`,
        content: s.purpose || s.signature,
        relevance: s.relevance,
      }))
    );
  } catch (error) {
    logError("semanticQuery:symbols", error);
  }

  // Search observations
  try {
    const obsResults = await db.all<{
      id: number;
      content: string;
      type: string;
      relevance: number;
    }>(
      `SELECT o.id, o.content, o.type,
             bm25(fts_observations) as relevance
      FROM fts_observations
      JOIN observations o ON fts_observations.rowid = o.id
      WHERE fts_observations MATCH ?1
      ORDER BY relevance
      LIMIT 3`,
      [safeQuery]
    );

    results.push(
      ...obsResults.map((o) => ({
        type: "observation" as const,
        id: o.id,
        title: `[${o.type}] ${o.content.slice(0, 50)}`,
        content: o.content,
        relevance: o.relevance,
      }))
    );
  } catch {
    // FTS table might not exist yet
  }

  // Search open questions
  try {
    const qResults = await db.all<{
      id: number;
      question: string;
      context: string | null;
      relevance: number;
    }>(
      `SELECT q.id, q.question, q.context,
             bm25(fts_questions) as relevance
      FROM fts_questions
      JOIN open_questions q ON fts_questions.rowid = q.id
      WHERE fts_questions MATCH ?1 AND q.status = 'open'
      ORDER BY relevance
      LIMIT 3`,
      [safeQuery]
    );

    results.push(
      ...qResults.map((q) => ({
        type: "question" as const,
        id: q.id,
        title: q.question,
        content: q.context,
        relevance: q.relevance,
      }))
    );
  } catch {
    // FTS table might not exist yet
  }

  // Sort by relevance and limit
  return results.sort((a, b) => a.relevance - b.relevance).slice(0, 10);
}

/**
 * Merge vector and FTS results, removing duplicates
 * Prioritizes vector results (they appear first)
 */
function mergeResults(vectorResults: QueryResult[], ftsResults: QueryResult[]): QueryResult[] {
  const seen = new Set<string>();
  const merged: QueryResult[] = [];

  // Add vector results first (higher priority)
  for (const result of vectorResults) {
    const key = `${result.type}:${result.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(result);
    }
  }

  // Add FTS results that aren't already in the list
  for (const result of ftsResults) {
    const key = `${result.type}:${result.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(result);
    }
  }

  return merged.slice(0, 10);
}

// ============================================================================
// Global Learning Queries
// ============================================================================

export async function searchGlobalLearnings(db: DatabaseAdapter, query: string): Promise<GlobalLearning[]> {
  const safeQuery = escapeFtsQuery(query);
  if (!safeQuery || safeQuery === '""') return [];

  try {
    return await db.all<GlobalLearning>(
      `SELECT g.* FROM fts_global_learnings
      JOIN global_learnings g ON fts_global_learnings.rowid = g.id
      WHERE fts_global_learnings MATCH ?
      ORDER BY g.times_applied DESC
      LIMIT 10`,
      [safeQuery]
    );
  } catch (error) {
    logError("searchGlobalLearnings", error);
    return [];
  }
}

export async function addGlobalLearning(
  db: DatabaseAdapter,
  category: string,
  title: string,
  content: string,
  context?: string,
  sourceProject?: string
): Promise<number> {
  const result = await db.run(
    `INSERT INTO global_learnings (category, title, content, context, source_project)
    VALUES (?, ?, ?, ?, ?)`,
    [category, title, content, context ?? null, sourceProject ?? null]
  );

  // Update FTS
  await db.run(
    `INSERT INTO fts_global_learnings(rowid, title, content, context)
    VALUES (?, ?, ?, ?)`,
    [result.lastInsertRowid, title, content, context ?? null]
  );

  return Number(result.lastInsertRowid);
}

// ============================================================================
// Pattern Queries
// ============================================================================

export async function searchPatterns(db: DatabaseAdapter, query: string): Promise<Pattern[]> {
  const safeQuery = escapeFtsQuery(query);
  if (!safeQuery || safeQuery === '""') return [];

  try {
    return await db.all<Pattern>(
      `SELECT p.* FROM fts_patterns
      JOIN patterns p ON fts_patterns.rowid = p.id
      WHERE fts_patterns MATCH ?
      LIMIT 10`,
      [safeQuery]
    );
  } catch (error) {
    logError("searchPatterns", error);
    return [];
  }
}

export async function getAllPatterns(db: DatabaseAdapter): Promise<Pattern[]> {
  return await db.all<Pattern>(`SELECT * FROM patterns ORDER BY name`);
}

export async function addPattern(
  db: DatabaseAdapter,
  name: string,
  description: string,
  codeExample?: string,
  antiPattern?: string,
  appliesTo?: string
): Promise<void> {
  await db.run(
    `INSERT INTO patterns (name, description, code_example, anti_pattern, applies_to)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      code_example = excluded.code_example,
      anti_pattern = excluded.anti_pattern,
      applies_to = excluded.applies_to`,
    [name, description, codeExample ?? null, antiPattern ?? null, appliesTo ?? null]
  );

  // Update FTS
  await db.run(
    `INSERT INTO fts_patterns(rowid, name, description, code_example)
    SELECT id, name, description, code_example FROM patterns WHERE name = ?`,
    [name]
  );
}

// ============================================================================
// Tech Debt Queries
// ============================================================================

export async function listTechDebt(
  db: DatabaseAdapter,
  projectPath?: string
): Promise<
  Array<{
    id: number;
    project_path: string;
    title: string;
    description: string | null;
    severity: number;
    effort: string | null;
    affected_files: string | null;
    status: string;
    created_at: string;
  }>
> {
  type TechDebtRow = {
    id: number;
    project_path: string;
    title: string;
    description: string | null;
    severity: number;
    effort: string | null;
    affected_files: string | null;
    status: string;
    created_at: string;
  };

  if (projectPath) {
    return await db.all<TechDebtRow>(
      `SELECT * FROM tech_debt WHERE project_path = ? AND status = 'open'
      ORDER BY severity DESC`,
      [projectPath]
    );
  }

  return await db.all<TechDebtRow>(
    `SELECT * FROM tech_debt WHERE status = 'open'
    ORDER BY severity DESC`
  );
}

export async function addTechDebt(
  db: DatabaseAdapter,
  projectPath: string,
  title: string,
  description?: string,
  severity: number = 5,
  effort?: string,
  affectedFiles?: string
): Promise<number> {
  const result = await db.run(
    `INSERT INTO tech_debt (project_path, title, description, severity, effort, affected_files)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [projectPath, title, description ?? null, severity, effort ?? "medium", affectedFiles ?? null]
  );

  return Number(result.lastInsertRowid);
}

export async function resolveTechDebt(db: DatabaseAdapter, id: number): Promise<void> {
  await db.run("UPDATE tech_debt SET status = 'resolved' WHERE id = ?", [id]);
}
