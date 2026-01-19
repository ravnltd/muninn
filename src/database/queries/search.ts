/**
 * Search and FTS queries
 * Full-text search and semantic query functionality
 * Fixes SQL injection by using parameterized queries
 */

import type { Database } from "bun:sqlite";
import type { QueryResult, GlobalLearning, Pattern } from "../../types";
import { logError } from "../../utils/errors";

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
}

/**
 * Perform semantic search across all knowledge
 * Uses parameterized queries to prevent SQL injection
 */
export function semanticQuery(
  db: Database,
  query: string,
  projectId?: number
): QueryResult[] {
  const results: QueryResult[] = [];

  // Search files
  try {
    const fileQuery = projectId
      ? db.query<FileSearchResult, [string, number]>(`
          SELECT f.id, f.path as title, f.purpose as content,
                 bm25(fts_files) as relevance
          FROM fts_files
          JOIN files f ON fts_files.rowid = f.id
          WHERE fts_files MATCH ?1 AND f.project_id = ?2
          ORDER BY relevance
          LIMIT 5
        `)
      : db.query<FileSearchResult, [string]>(`
          SELECT f.id, f.path as title, f.purpose as content,
                 bm25(fts_files) as relevance
          FROM fts_files
          JOIN files f ON fts_files.rowid = f.id
          WHERE fts_files MATCH ?1
          ORDER BY relevance
          LIMIT 5
        `);

    const files = projectId
      ? fileQuery.all(query, projectId)
      : (fileQuery as ReturnType<typeof db.query<FileSearchResult, [string]>>).all(query);

    results.push(...files.map(f => ({
      type: 'file' as const,
      id: f.id,
      title: f.title,
      content: f.content,
      relevance: f.relevance,
    })));
  } catch (error) {
    logError('semanticQuery:files', error);
  }

  // Search decisions
  try {
    const decisionQuery = projectId
      ? db.query<DecisionSearchResult, [string, number]>(`
          SELECT d.id, d.title, d.decision as content,
                 bm25(fts_decisions) as relevance
          FROM fts_decisions
          JOIN decisions d ON fts_decisions.rowid = d.id
          WHERE fts_decisions MATCH ?1 AND d.project_id = ?2
          ORDER BY relevance
          LIMIT 5
        `)
      : db.query<DecisionSearchResult, [string]>(`
          SELECT d.id, d.title, d.decision as content,
                 bm25(fts_decisions) as relevance
          FROM fts_decisions
          JOIN decisions d ON fts_decisions.rowid = d.id
          WHERE fts_decisions MATCH ?1
          ORDER BY relevance
          LIMIT 5
        `);

    const decisions = projectId
      ? decisionQuery.all(query, projectId)
      : (decisionQuery as ReturnType<typeof db.query<DecisionSearchResult, [string]>>).all(query);

    results.push(...decisions.map(d => ({
      type: 'decision' as const,
      id: d.id,
      title: d.title,
      content: d.content,
      relevance: d.relevance,
    })));
  } catch (error) {
    logError('semanticQuery:decisions', error);
  }

  // Search issues
  try {
    const issueQuery = projectId
      ? db.query<IssueSearchResult, [string, number]>(`
          SELECT i.id, i.title, i.description as content,
                 bm25(fts_issues) as relevance
          FROM fts_issues
          JOIN issues i ON fts_issues.rowid = i.id
          WHERE fts_issues MATCH ?1 AND i.project_id = ?2
          ORDER BY relevance
          LIMIT 5
        `)
      : db.query<IssueSearchResult, [string]>(`
          SELECT i.id, i.title, i.description as content,
                 bm25(fts_issues) as relevance
          FROM fts_issues
          JOIN issues i ON fts_issues.rowid = i.id
          WHERE fts_issues MATCH ?1
          ORDER BY relevance
          LIMIT 5
        `);

    const issues = projectId
      ? issueQuery.all(query, projectId)
      : (issueQuery as ReturnType<typeof db.query<IssueSearchResult, [string]>>).all(query);

    results.push(...issues.map(i => ({
      type: 'issue' as const,
      id: i.id,
      title: i.title,
      content: i.content,
      relevance: i.relevance,
    })));
  } catch (error) {
    logError('semanticQuery:issues', error);
  }

  // Search learnings
  try {
    const learningQuery = projectId
      ? db.query<LearningSearchResult, [string, number]>(`
          SELECT l.id, l.title, l.content,
                 bm25(fts_learnings) as relevance
          FROM fts_learnings
          JOIN learnings l ON fts_learnings.rowid = l.id
          WHERE fts_learnings MATCH ?1 AND (l.project_id = ?2 OR l.project_id IS NULL)
          ORDER BY relevance
          LIMIT 5
        `)
      : db.query<LearningSearchResult, [string]>(`
          SELECT l.id, l.title, l.content,
                 bm25(fts_learnings) as relevance
          FROM fts_learnings
          JOIN learnings l ON fts_learnings.rowid = l.id
          WHERE fts_learnings MATCH ?1
          ORDER BY relevance
          LIMIT 5
        `);

    const learnings = projectId
      ? learningQuery.all(query, projectId)
      : (learningQuery as ReturnType<typeof db.query<LearningSearchResult, [string]>>).all(query);

    results.push(...learnings.map(l => ({
      type: 'learning' as const,
      id: l.id,
      title: l.title,
      content: l.content,
      relevance: l.relevance,
    })));
  } catch (error) {
    logError('semanticQuery:learnings', error);
  }

  // Sort by relevance and limit
  return results
    .sort((a, b) => a.relevance - b.relevance)
    .slice(0, 10);
}

// ============================================================================
// Global Learning Queries
// ============================================================================

export function searchGlobalLearnings(db: Database, query: string): GlobalLearning[] {
  try {
    return db.query<GlobalLearning, [string]>(`
      SELECT g.* FROM fts_global_learnings
      JOIN global_learnings g ON fts_global_learnings.rowid = g.id
      WHERE fts_global_learnings MATCH ?
      ORDER BY g.times_applied DESC
      LIMIT 10
    `).all(query);
  } catch (error) {
    logError('searchGlobalLearnings', error);
    return [];
  }
}

export function addGlobalLearning(
  db: Database,
  category: string,
  title: string,
  content: string,
  context?: string,
  sourceProject?: string
): number {
  const result = db.run(`
    INSERT INTO global_learnings (category, title, content, context, source_project)
    VALUES (?, ?, ?, ?, ?)
  `, [category, title, content, context ?? null, sourceProject ?? null]);

  // Update FTS
  db.run(`
    INSERT INTO fts_global_learnings(rowid, title, content, context)
    VALUES (?, ?, ?, ?)
  `, [result.lastInsertRowid, title, content, context ?? null]);

  return Number(result.lastInsertRowid);
}

// ============================================================================
// Pattern Queries
// ============================================================================

export function searchPatterns(db: Database, query: string): Pattern[] {
  try {
    return db.query<Pattern, [string]>(`
      SELECT p.* FROM fts_patterns
      JOIN patterns p ON fts_patterns.rowid = p.id
      WHERE fts_patterns MATCH ?
      LIMIT 10
    `).all(query);
  } catch (error) {
    logError('searchPatterns', error);
    return [];
  }
}

export function getAllPatterns(db: Database): Pattern[] {
  return db.query<Pattern, []>(`
    SELECT * FROM patterns ORDER BY name
  `).all();
}

export function addPattern(
  db: Database,
  name: string,
  description: string,
  codeExample?: string,
  antiPattern?: string,
  appliesTo?: string
): void {
  db.run(`
    INSERT INTO patterns (name, description, code_example, anti_pattern, applies_to)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      code_example = excluded.code_example,
      anti_pattern = excluded.anti_pattern,
      applies_to = excluded.applies_to
  `, [name, description, codeExample ?? null, antiPattern ?? null, appliesTo ?? null]);

  // Update FTS
  db.run(`
    INSERT INTO fts_patterns(rowid, name, description, code_example)
    SELECT id, name, description, code_example FROM patterns WHERE name = ?
  `, [name]);
}

// ============================================================================
// Tech Debt Queries
// ============================================================================

export function listTechDebt(db: Database, projectPath?: string): Array<{
  id: number;
  project_path: string;
  title: string;
  description: string | null;
  severity: number;
  effort: string | null;
  affected_files: string | null;
  status: string;
  created_at: string;
}> {
  if (projectPath) {
    return db.query<{
      id: number;
      project_path: string;
      title: string;
      description: string | null;
      severity: number;
      effort: string | null;
      affected_files: string | null;
      status: string;
      created_at: string;
    }, [string]>(`
      SELECT * FROM tech_debt WHERE project_path = ? AND status = 'open'
      ORDER BY severity DESC
    `).all(projectPath);
  }

  return db.query<{
    id: number;
    project_path: string;
    title: string;
    description: string | null;
    severity: number;
    effort: string | null;
    affected_files: string | null;
    status: string;
    created_at: string;
  }, []>(`
    SELECT * FROM tech_debt WHERE status = 'open'
    ORDER BY severity DESC
  `).all();
}

export function addTechDebt(
  db: Database,
  projectPath: string,
  title: string,
  description?: string,
  severity: number = 5,
  effort?: string,
  affectedFiles?: string
): number {
  const result = db.run(`
    INSERT INTO tech_debt (project_path, title, description, severity, effort, affected_files)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [projectPath, title, description ?? null, severity, effort ?? 'medium', affectedFiles ?? null]);

  return Number(result.lastInsertRowid);
}

export function resolveTechDebt(db: Database, id: number): void {
  db.run("UPDATE tech_debt SET status = 'resolved' WHERE id = ?", [id]);
}
