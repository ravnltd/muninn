/**
 * Diff Analyzer — Automatic commit intent analysis
 *
 * Processes unprocessed git_commits rows in background worker.
 * Uses Haiku LLM for 1-2 sentence intent summary.
 * Falls back to commit message parsing if no API key.
 * Max 5 commits per batch to limit LLM cost.
 *
 * Runs in cold path only (background worker). Never in MCP hot path.
 */

import type { DatabaseAdapter } from "../database/adapter";
import { getApiKey, redactApiKeys } from "../utils/api-keys";

// ============================================================================
// Types
// ============================================================================

type IntentCategory = "bugfix" | "feature" | "refactor" | "config" | "docs" | "test" | "chore" | "unknown";

interface DiffAnalysis {
  commitId: number;
  intentSummary: string;
  intentCategory: IntentCategory;
  changedFunctions: string[];
  analyzedBy: "llm" | "heuristic";
}

interface UnprocessedCommit {
  id: number;
  commit_hash: string;
  message: string;
  files_changed: string | null;
  insertions: number;
  deletions: number;
}

// ============================================================================
// Heuristic Category Detection
// ============================================================================

const CATEGORY_PATTERNS: Array<{ category: IntentCategory; patterns: RegExp[] }> = [
  { category: "bugfix", patterns: [/\bfix\b/i, /\bbug\b/i, /\bresolve[ds]?\b/i, /\bpatch\b/i, /\bhotfix\b/i] },
  { category: "feature", patterns: [/\bfeat\b/i, /\badd[es]?\b/i, /\bimplement/i, /\bnew\b/i, /\bintroduce/i] },
  { category: "refactor", patterns: [/\brefactor/i, /\bclean/i, /\brestructure/i, /\bextract/i, /\bmove\b/i, /\brename/i] },
  { category: "test", patterns: [/\btest/i, /\bspec\b/i, /\bcoverage/i] },
  { category: "docs", patterns: [/\bdoc[s]?\b/i, /\breadme/i, /\bcomment/i, /\bchangelog/i] },
  { category: "config", patterns: [/\bconfig/i, /\bsetup\b/i, /\bci\b/i, /\bbuild\b/i, /\bdeps?\b/i, /\bbump\b/i] },
  { category: "chore", patterns: [/\bchore\b/i, /\bcleanup\b/i, /\blint/i, /\bformat/i] },
];

/** Detect intent category from commit message using heuristics */
function detectCategory(message: string): IntentCategory {
  // Check conventional commit prefix first (feat:, fix:, etc.)
  const conventionalMatch = message.match(/^(\w+)(?:\(.+?\))?:/);
  if (conventionalMatch) {
    const prefix = conventionalMatch[1].toLowerCase();
    const prefixMap: Record<string, IntentCategory> = {
      feat: "feature", fix: "bugfix", refactor: "refactor", test: "test",
      docs: "docs", chore: "chore", ci: "config", build: "config",
      perf: "refactor", style: "chore",
    };
    if (prefixMap[prefix]) return prefixMap[prefix];
  }

  // Fall back to pattern matching
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some((p) => p.test(message))) return category;
  }

  return "unknown";
}

/** Create a heuristic intent summary from commit message */
function heuristicSummary(message: string, files: string[]): string {
  // Use first line of commit message, cleaned up
  const firstLine = message.split("\n")[0].trim();
  const cleaned = firstLine.replace(/^(\w+)(?:\(.+?\))?:\s*/, "").trim();

  if (files.length > 0 && files.length <= 3) {
    return `${cleaned} (${files.join(", ")})`;
  }
  if (files.length > 3) {
    return `${cleaned} (${files.length} files)`;
  }
  return cleaned;
}

// ============================================================================
// LLM Analysis
// ============================================================================

/** Analyze a commit using Haiku LLM */
async function analyzeWithLLM(
  apiKey: string,
  commit: UnprocessedCommit
): Promise<{ summary: string; category: IntentCategory } | null> {
  const files = commit.files_changed ? JSON.parse(commit.files_changed) as string[] : [];

  const prompt = `Analyze this git commit and respond with ONLY valid JSON.

Commit: ${commit.message}
Files: ${files.slice(0, 15).join(", ")}${files.length > 15 ? ` (+${files.length - 15} more)` : ""}
Changes: +${commit.insertions}/-${commit.deletions}

Response format:
{"summary": "1 sentence describing intent", "category": "bugfix|feature|refactor|config|docs|test|chore"}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${redactApiKeys(errorText)}`);
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    const text = data.content[0]?.text || "";

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; category?: string };
    const validCategories: IntentCategory[] = ["bugfix", "feature", "refactor", "config", "docs", "test", "chore"];
    const category = validCategories.includes(parsed.category as IntentCategory)
      ? (parsed.category as IntentCategory)
      : detectCategory(commit.message);

    return {
      summary: parsed.summary || heuristicSummary(commit.message, files),
      category,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Process unanalyzed git commits. Max 5 per batch.
 * Uses LLM if API key available, falls back to heuristic.
 * Runs in background worker only.
 */
export async function analyzeUnprocessedCommits(
  db: DatabaseAdapter,
  projectId: number,
  maxBatch: number = 5
): Promise<DiffAnalysis[]> {
  // Get unprocessed commits
  const commits = await db.all<UnprocessedCommit>(
    `SELECT gc.id, gc.commit_hash, gc.message, gc.files_changed, gc.insertions, gc.deletions
     FROM git_commits gc
     LEFT JOIN diff_analyses da ON gc.id = da.commit_id
     WHERE gc.project_id = ? AND da.id IS NULL AND gc.analyzed = 0
     ORDER BY gc.committed_at ASC
     LIMIT ?`,
    [projectId, maxBatch]
  );

  if (commits.length === 0) return [];

  // Check for API key
  const keyResult = getApiKey("anthropic");
  const apiKey = keyResult.ok ? keyResult.value : null;

  const results: DiffAnalysis[] = [];

  for (const commit of commits) {
    const files = commit.files_changed ? JSON.parse(commit.files_changed) as string[] : [];

    let analysis: DiffAnalysis;

    // Try LLM first
    if (apiKey) {
      const llmResult = await analyzeWithLLM(apiKey, commit);
      if (llmResult) {
        analysis = {
          commitId: commit.id,
          intentSummary: llmResult.summary,
          intentCategory: llmResult.category,
          changedFunctions: [], // Phase 4 will populate this from AST
          analyzedBy: "llm",
        };
      } else {
        // LLM failed, fall back to heuristic
        analysis = {
          commitId: commit.id,
          intentSummary: heuristicSummary(commit.message, files),
          intentCategory: detectCategory(commit.message),
          changedFunctions: [],
          analyzedBy: "heuristic",
        };
      }
    } else {
      // No API key — heuristic only
      analysis = {
        commitId: commit.id,
        intentSummary: heuristicSummary(commit.message, files),
        intentCategory: detectCategory(commit.message),
        changedFunctions: [],
        analyzedBy: "heuristic",
      };
    }

    // Populate changedFunctions from symbols table (approximate: all functions in changed files)
    if (files.length > 0) {
      try {
        const placeholders = files.map(() => "?").join(",");
        const symbols = await db.all<{ name: string }>(
          `SELECT name FROM symbols
           WHERE project_id = ? AND file_path IN (${placeholders})
           AND kind IN ('function', 'method', 'arrow')
           ORDER BY name`,
          [projectId, ...files]
        );
        analysis.changedFunctions = symbols.map((s) => s.name);
      } catch {
        // symbols table might not be populated yet
      }
    }

    // Store analysis
    await db.run(
      `INSERT OR IGNORE INTO diff_analyses (project_id, commit_id, intent_summary, intent_category, changed_functions, analyzed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        analysis.commitId,
        analysis.intentSummary,
        analysis.intentCategory,
        JSON.stringify(analysis.changedFunctions),
        analysis.analyzedBy,
      ]
    );

    // Mark commit as analyzed
    await db.run(`UPDATE git_commits SET analyzed = 1 WHERE id = ?`, [commit.id]);

    results.push(analysis);
  }

  return results;
}
