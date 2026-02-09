/**
 * Task Analyzer
 *
 * Runs on first meaningful tool call to extract task type, domains,
 * and relevant context from keywords. No LLM — keyword extraction only.
 *
 * Budget: <50ms for keyword extraction, async DB lookups non-blocking.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export type TaskType =
  | "bugfix"
  | "feature"
  | "refactor"
  | "testing"
  | "documentation"
  | "performance"
  | "configuration"
  | "exploration"
  | "unknown";

export interface RelevantFile {
  path: string;
  fragility: number;
  purpose: string | null;
  score: number;
}

export interface RelevantDecision {
  id: number;
  title: string;
  decision: string;
  outcomeStatus: string;
  score: number;
}

export interface RelevantLearning {
  id: number;
  category: string;
  title: string;
  content: string;
  confidence: number;
  score: number;
}

export interface RelevantIssue {
  id: number;
  title: string;
  severity: number;
  type: string;
  score: number;
}

export interface ErrorFix {
  signature: string;
  fixDescription: string;
  fixFiles: string;
  confidence: number;
}

export interface TaskContext {
  taskType: TaskType;
  domains: string[];
  keywords: string[];
  files: string[];
  relevantFiles: RelevantFile[];
  relevantDecisions: RelevantDecision[];
  relevantLearnings: RelevantLearning[];
  relevantIssues: RelevantIssue[];
  errorFixes: ErrorFix[];
  analyzedAt: number;
}

// ============================================================================
// Keyword Extraction
// ============================================================================

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "shall",
  "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "this",
  "that", "these", "those", "it", "its", "my", "your", "our",
  "and", "or", "but", "not", "no", "all", "each", "every",
  "if", "then", "else", "when", "up", "out", "so", "than",
]);

/** Extract meaningful keywords from tool call arguments */
export function extractKeywords(toolName: string, args: Record<string, unknown>): string[] {
  const words = new Set<string>();

  // Extract from common arg fields
  const textFields = ["query", "task", "goal", "title", "content", "description", "command"];
  for (const field of textFields) {
    const value = args[field];
    if (typeof value === "string") {
      for (const word of tokenize(value)) {
        words.add(word);
      }
    }
  }

  // Extract from file paths
  const fileFields = ["path", "file_path", "files"];
  for (const field of fileFields) {
    const value = args[field];
    if (typeof value === "string") {
      for (const term of extractPathTerms(value)) {
        words.add(term);
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          for (const term of extractPathTerms(item)) {
            words.add(term);
          }
        }
      }
    }
  }

  // Tool name hints
  if (toolName === "muninn_check") words.add("edit");
  if (toolName === "muninn_issue") words.add("issue");

  return Array.from(words);
}

/** Extract file paths from tool arguments */
export function extractFiles(args: Record<string, unknown>): string[] {
  const files: string[] = [];

  const pathValue = args.path ?? args.file_path;
  if (typeof pathValue === "string") files.push(pathValue);

  const filesValue = args.files;
  if (Array.isArray(filesValue)) {
    for (const f of filesValue) {
      if (typeof f === "string") files.push(f);
    }
  }

  // Parse enrich input JSON
  if (typeof args.input === "string") {
    try {
      const parsed = JSON.parse(args.input) as Record<string, unknown>;
      if (typeof parsed.file_path === "string") files.push(parsed.file_path);
    } catch {
      // Not valid JSON
    }
  }

  return files;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, " ")
    .split(/[\s-_]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function extractPathTerms(filePath: string): string[] {
  const terms: string[] = [];
  const parts = filePath.split("/").filter(Boolean);

  for (const part of parts) {
    // Skip common non-meaningful dirs
    if (["src", "lib", "dist", "build", "node_modules", ".git"].includes(part)) continue;

    // Split camelCase and kebab-case
    const subParts = part
      .replace(/\.[^/.]+$/, "") // Remove extension
      .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase
      .toLowerCase()
      .split(/[\s-_]+/)
      .filter((w) => w.length >= 3);

    terms.push(...subParts);
  }

  return terms;
}

// ============================================================================
// Task Type Detection
// ============================================================================

const TASK_TYPE_PATTERNS: Record<TaskType, string[]> = {
  bugfix: ["fix", "bug", "error", "issue", "broken", "crash", "fail", "wrong", "incorrect", "patch"],
  feature: ["add", "create", "implement", "new", "feature", "build", "introduce", "support"],
  refactor: ["refactor", "clean", "reorganize", "extract", "simplify", "restructure", "consolidate", "move"],
  testing: ["test", "spec", "coverage", "assert", "mock", "fixture", "e2e", "unit", "integration"],
  documentation: ["doc", "readme", "comment", "explain", "document", "guide", "tutorial"],
  performance: ["perf", "optimize", "speed", "slow", "fast", "cache", "memory", "latency"],
  configuration: ["config", "setup", "deploy", "env", "install", "build", "ci", "cd", "docker"],
  exploration: ["find", "search", "look", "understand", "explore", "investigate", "check", "review"],
  unknown: [],
};

/** Detect task type from extracted keywords */
export function detectTaskType(keywords: string[]): TaskType {
  const scores: Partial<Record<TaskType, number>> = {};

  for (const keyword of keywords) {
    for (const [taskType, patterns] of Object.entries(TASK_TYPE_PATTERNS)) {
      if (taskType === "unknown") continue;
      for (const pattern of patterns) {
        if (keyword === pattern || keyword.startsWith(pattern)) {
          scores[taskType as TaskType] = (scores[taskType as TaskType] ?? 0) + 1;
        }
      }
    }
  }

  let bestType: TaskType = "unknown";
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type as TaskType;
    }
  }

  return bestType;
}

/** Extract domain areas from file paths */
export function extractDomains(files: string[]): string[] {
  const domains = new Set<string>();

  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    // Look for domain-like directory names
    for (const part of parts) {
      if (["src", "lib", "dist", "build", "test", "tests", "node_modules", ".git"].includes(part)) continue;
      if (part.includes(".")) continue; // Skip files
      if (part.length >= 3) {
        domains.add(part.toLowerCase());
      }
    }
  }

  return Array.from(domains).slice(0, 5);
}

// ============================================================================
// Full Task Analysis (with DB lookups)
// ============================================================================

/** Build complete task context — async DB lookups for relevant items */
export async function analyzeTask(
  db: DatabaseAdapter,
  projectId: number,
  toolName: string,
  args: Record<string, unknown>
): Promise<TaskContext> {
  const keywords = extractKeywords(toolName, args);
  const files = extractFiles(args);
  const taskType = detectTaskType(keywords);
  const domains = extractDomains(files);

  // Combine keywords + domains for search
  const searchTerms = [...new Set([...keywords, ...domains])].slice(0, 10);
  const searchQuery = searchTerms.join(" ");

  // Run all DB lookups in parallel (all best-effort)
  const [relevantFiles, relevantDecisions, relevantLearnings, relevantIssues, errorFixes] = await Promise.all([
    findRelevantFiles(db, projectId, searchQuery, files),
    findRelevantDecisions(db, projectId, searchQuery, files),
    findRelevantLearnings(db, projectId, searchQuery),
    findRelevantIssues(db, projectId, searchQuery),
    findErrorFixes(db, projectId, taskType, searchQuery),
  ]);

  return {
    taskType,
    domains,
    keywords: searchTerms,
    files,
    relevantFiles,
    relevantDecisions,
    relevantLearnings,
    relevantIssues,
    errorFixes,
    analyzedAt: Date.now(),
  };
}

// ============================================================================
// DB Lookups (all best-effort with try/catch)
// ============================================================================

async function findRelevantFiles(
  db: DatabaseAdapter,
  projectId: number,
  query: string,
  directFiles: string[]
): Promise<RelevantFile[]> {
  try {
    const results: RelevantFile[] = [];

    // Direct file matches (highest score)
    for (const path of directFiles.slice(0, 5)) {
      const file = await db.get<{ path: string; fragility: number; purpose: string | null }>(
        `SELECT path, fragility, purpose FROM files WHERE project_id = ? AND path = ?`,
        [projectId, path]
      );
      if (file) {
        results.push({ ...file, score: 1.0 });
      }
    }

    // FTS search for related files
    if (query.length >= 3) {
      try {
        const ftsResults = await db.all<{ path: string; fragility: number; purpose: string | null }>(
          `SELECT f.path, f.fragility, f.purpose
           FROM fts_files JOIN files f ON fts_files.rowid = f.id
           WHERE fts_files MATCH ? AND f.project_id = ?
           ORDER BY bm25(fts_files) LIMIT 5`,
          [query, projectId]
        );
        for (const r of ftsResults) {
          if (!results.find((x) => x.path === r.path)) {
            results.push({ ...r, score: 0.6 });
          }
        }
      } catch {
        // FTS might not be available
      }
    }

    return results.slice(0, 8);
  } catch {
    return [];
  }
}

async function findRelevantDecisions(
  db: DatabaseAdapter,
  projectId: number,
  query: string,
  files: string[]
): Promise<RelevantDecision[]> {
  try {
    const results: RelevantDecision[] = [];
    const seen = new Set<number>();

    // Decisions affecting touched files
    for (const file of files.slice(0, 3)) {
      const fileDecisions = await db.all<{
        id: number; title: string; decision: string; outcome_status: string;
      }>(
        `SELECT id, title, decision, outcome_status FROM decisions
         WHERE project_id = ? AND status = 'active' AND affects LIKE '%' || ? || '%'
         ORDER BY CASE outcome_status WHEN 'failed' THEN 0 ELSE 1 END, decided_at DESC
         LIMIT 3`,
        [projectId, file]
      );
      for (const d of fileDecisions) {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          results.push({
            id: d.id,
            title: d.title,
            decision: d.decision,
            outcomeStatus: d.outcome_status || "pending",
            score: d.outcome_status === "failed" ? 1.0 : 0.8,
          });
        }
      }
    }

    // FTS search for keyword-matched decisions
    if (query.length >= 3) {
      try {
        const ftsResults = await db.all<{
          id: number; title: string; decision: string; outcome_status: string;
        }>(
          `SELECT d.id, d.title, d.decision, d.outcome_status
           FROM fts_decisions JOIN decisions d ON fts_decisions.rowid = d.id
           WHERE fts_decisions MATCH ? AND d.project_id = ? AND d.status = 'active'
           ORDER BY bm25(fts_decisions) LIMIT 3`,
          [query, projectId]
        );
        for (const d of ftsResults) {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            results.push({
              id: d.id,
              title: d.title,
              decision: d.decision,
              outcomeStatus: d.outcome_status || "pending",
              score: 0.5,
            });
          }
        }
      } catch {
        // FTS might not be available
      }
    }

    return results.slice(0, 5);
  } catch {
    return [];
  }
}

async function findRelevantLearnings(
  db: DatabaseAdapter,
  projectId: number,
  query: string
): Promise<RelevantLearning[]> {
  try {
    if (query.length < 3) return [];

    try {
      const results = await db.all<{
        id: number; category: string; title: string; content: string; confidence: number;
      }>(
        `SELECT l.id, l.category, l.title, l.content, l.confidence
         FROM fts_learnings JOIN learnings l ON fts_learnings.rowid = l.id
         WHERE fts_learnings MATCH ? AND (l.project_id = ? OR l.project_id IS NULL)
           AND l.archived_at IS NULL
         ORDER BY bm25(fts_learnings) LIMIT 5`,
        [query, projectId]
      );
      return results.map((r) => ({ ...r, score: 0.6 }));
    } catch {
      // FTS fallback
      const results = await db.all<{
        id: number; category: string; title: string; content: string; confidence: number;
      }>(
        `SELECT id, category, title, content, confidence FROM learnings
         WHERE (project_id = ? OR project_id IS NULL) AND archived_at IS NULL
           AND (title LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%')
         ORDER BY confidence DESC LIMIT 5`,
        [projectId, query.split(" ")[0], query.split(" ")[0]]
      );
      return results.map((r) => ({ ...r, score: 0.4 }));
    }
  } catch {
    return [];
  }
}

async function findRelevantIssues(
  db: DatabaseAdapter,
  projectId: number,
  query: string
): Promise<RelevantIssue[]> {
  try {
    if (query.length < 3) return [];

    try {
      const results = await db.all<{
        id: number; title: string; severity: number; type: string;
      }>(
        `SELECT i.id, i.title, i.severity, i.type
         FROM fts_issues JOIN issues i ON fts_issues.rowid = i.id
         WHERE fts_issues MATCH ? AND i.project_id = ? AND i.status = 'open'
         ORDER BY i.severity DESC LIMIT 3`,
        [query, projectId]
      );
      return results.map((r) => ({ ...r, score: 0.7 }));
    } catch {
      // FTS fallback
      const results = await db.all<{
        id: number; title: string; severity: number; type: string;
      }>(
        `SELECT id, title, severity, type FROM issues
         WHERE project_id = ? AND status = 'open'
           AND (title LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%')
         ORDER BY severity DESC LIMIT 3`,
        [projectId, query.split(" ")[0], query.split(" ")[0]]
      );
      return results.map((r) => ({ ...r, score: 0.5 }));
    }
  } catch {
    return [];
  }
}

async function findErrorFixes(
  db: DatabaseAdapter,
  projectId: number,
  taskType: TaskType,
  query: string
): Promise<ErrorFix[]> {
  try {
    // Only look for error fixes if task looks like a bugfix
    if (taskType !== "bugfix" && !query.includes("error") && !query.includes("fix")) {
      return [];
    }

    const results = await db.all<{
      error_signature: string;
      fix_description: string;
      fix_files: string;
      confidence: number;
    }>(
      `SELECT error_signature, fix_description, fix_files, confidence
       FROM error_fix_pairs
       WHERE project_id = ? AND confidence >= 0.5
       ORDER BY times_fixed DESC, confidence DESC
       LIMIT 3`,
      [projectId]
    );

    return results.map((r) => ({
      signature: r.error_signature,
      fixDescription: r.fix_description || "",
      fixFiles: r.fix_files || "",
      confidence: r.confidence,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// Module State
// ============================================================================

let currentTaskContext: TaskContext | null = null;

/** Get the current task context (set by analyzeTask) */
export function getTaskContext(): TaskContext | null {
  return currentTaskContext;
}

/** Set the current task context */
export function setTaskContext(ctx: TaskContext): void {
  currentTaskContext = ctx;
}

/** Clear the task context */
export function clearTaskContext(): void {
  currentTaskContext = null;
}
