/**
 * Session Analyzer — Tool-log-based session analysis
 *
 * Replaces optional transcript analysis with mandatory tool-log analysis.
 * At session end: queries tool_calls for this session, builds structured summary,
 * feeds to Haiku LLM for learning extraction.
 *
 * Falls back to heuristic extraction without API key.
 * Always runs — not gated by --analyze flag.
 */

import type { DatabaseAdapter } from "../database/adapter";
import { getApiKey } from "../utils/api-keys";
import type { ExtractedLearning } from "../commands/learning-extraction";

// ============================================================================
// Types
// ============================================================================

interface ToolCallSummary {
  toolName: string;
  count: number;
  filesInvolved: string[];
  errorCount: number;
}

interface SessionSummary {
  totalCalls: number;
  uniqueTools: number;
  toolBreakdown: ToolCallSummary[];
  filesRead: string[];
  filesModified: string[];
  errorsEncountered: number;
  durationMinutes: number;
}

// ============================================================================
// Session Summary Builder
// ============================================================================

/**
 * Build a structured summary from tool call logs for a session.
 */
export async function buildSessionSummary(
  db: DatabaseAdapter,
  sessionId: number
): Promise<SessionSummary> {
  // Get tool call aggregates
  const toolAggs = await db.all<{
    tool_name: string;
    cnt: number;
    error_cnt: number;
    files: string | null;
  }>(
    `SELECT
       tool_name,
       COUNT(*) as cnt,
       SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_cnt,
       GROUP_CONCAT(files_involved, '||') as files
     FROM tool_calls
     WHERE session_id = ?
     GROUP BY tool_name
     ORDER BY cnt DESC`,
    [sessionId]
  );

  // Extract file lists per tool
  const allFilesRead = new Set<string>();
  const allFilesModified = new Set<string>();
  const toolBreakdown: ToolCallSummary[] = [];

  for (const agg of toolAggs) {
    const filesInvolved: string[] = [];
    if (agg.files) {
      for (const chunk of agg.files.split("||")) {
        try {
          const parsed = JSON.parse(chunk) as string[];
          filesInvolved.push(...parsed);
        } catch {
          // Not valid JSON
        }
      }
    }

    const uniqueFiles = [...new Set(filesInvolved)];

    // Categorize files by tool type
    const readTools = ["muninn_query", "muninn_check", "muninn_predict", "muninn_suggest", "muninn_enrich"];
    const writeTools = ["muninn_file_add", "muninn_decision_add", "muninn_learn_add", "muninn_issue"];

    if (readTools.includes(agg.tool_name)) {
      for (const f of uniqueFiles) allFilesRead.add(f);
    } else if (writeTools.includes(agg.tool_name)) {
      for (const f of uniqueFiles) allFilesModified.add(f);
    }

    toolBreakdown.push({
      toolName: agg.tool_name,
      count: agg.cnt,
      filesInvolved: uniqueFiles,
      errorCount: agg.error_cnt,
    });
  }

  // Calculate session duration
  const timing = await db.get<{ started: string; ended: string }>(
    `SELECT MIN(created_at) as started, MAX(created_at) as ended
     FROM tool_calls WHERE session_id = ?`,
    [sessionId]
  );
  const durationMs = timing
    ? new Date(timing.ended).getTime() - new Date(timing.started).getTime()
    : 0;

  const totalCalls = toolAggs.reduce((sum, t) => sum + t.cnt, 0);
  const totalErrors = toolAggs.reduce((sum, t) => sum + t.error_cnt, 0);

  return {
    totalCalls,
    uniqueTools: toolAggs.length,
    toolBreakdown,
    filesRead: [...allFilesRead],
    filesModified: [...allFilesModified],
    errorsEncountered: totalErrors,
    durationMinutes: Math.round(durationMs / 60000),
  };
}

// ============================================================================
// Learning Extraction
// ============================================================================

/**
 * Extract learnings from a session using tool call analysis.
 * Uses LLM if available, falls back to heuristic.
 */
export async function analyzeSession(
  db: DatabaseAdapter,
  _projectId: number,
  sessionId: number,
  sessionGoal: string
): Promise<ExtractedLearning[]> {
  const summary = await buildSessionSummary(db, sessionId);
  if (summary.totalCalls === 0) return [];

  // Try LLM extraction
  const keyResult = getApiKey("anthropic");
  if (keyResult.ok) {
    const llmResult = await extractWithLLM(keyResult.value, summary, sessionGoal);
    if (llmResult.length > 0) return llmResult;
  }

  // Fall back to heuristic extraction
  return extractHeuristic(summary, sessionGoal);
}

/** Extract learnings using Haiku LLM */
async function extractWithLLM(
  apiKey: string,
  summary: SessionSummary,
  goal: string
): Promise<ExtractedLearning[]> {
  const toolSummaryText = summary.toolBreakdown
    .map((t) => `  ${t.toolName}: ${t.count}x${t.errorCount > 0 ? ` (${t.errorCount} errors)` : ""}`)
    .join("\n");

  const prompt = `Analyze this coding session and extract 0-3 reusable learnings.

SESSION GOAL: ${goal}
DURATION: ${summary.durationMinutes} minutes
TOOL CALLS: ${summary.totalCalls} total, ${summary.uniqueTools} unique tools
ERRORS: ${summary.errorsEncountered}

TOOL BREAKDOWN:
${toolSummaryText}

FILES MODIFIED: ${summary.filesModified.slice(0, 15).join(", ")}${summary.filesModified.length > 15 ? ` (+${summary.filesModified.length - 15} more)` : ""}

Focus on:
1. Workflow patterns (tool usage sequences that worked)
2. Gotchas (errors encountered and resolved)
3. Conventions established

Return ONLY a JSON array:
[{"title": "Short title", "content": "The learning", "category": "pattern|gotcha|preference|convention", "confidence": 0.0-1.0}]
If no meaningful learnings, return: []`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    const text = data.content[0]?.text || "[]";

    // Parse JSON
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is ExtractedLearning => {
        const obj = item as Record<string, unknown>;
        return (
          typeof obj.title === "string" &&
          typeof obj.content === "string" &&
          typeof obj.category === "string" &&
          typeof obj.confidence === "number"
        );
      }
    );
  } catch {
    return [];
  }
}

/** Extract learnings using heuristics (no LLM needed) */
function extractHeuristic(summary: SessionSummary, goal: string): ExtractedLearning[] {
  const learnings: ExtractedLearning[] = [];

  // Pattern: High error rate
  if (summary.errorsEncountered > 0 && summary.totalCalls > 5) {
    const errorRate = summary.errorsEncountered / summary.totalCalls;
    if (errorRate > 0.2) {
      learnings.push({
        title: "High error rate in session",
        content: `${Math.round(errorRate * 100)}% of tool calls failed during "${goal}". Consider checking prerequisites before starting similar tasks.`,
        category: "gotcha",
        confidence: 0.6,
      });
    }
  }

  // Pattern: Many files modified
  if (summary.filesModified.length > 10) {
    learnings.push({
      title: "Wide-impact session",
      content: `Session modified ${summary.filesModified.length} files. Large changesets increase risk. Consider breaking into smaller batches.`,
      category: "pattern",
      confidence: 0.5,
    });
  }

  // Pattern: Heavy query usage (exploration-heavy session)
  const queryCount = summary.toolBreakdown
    .filter((t) => ["muninn_query", "muninn_check", "muninn_suggest"].includes(t.toolName))
    .reduce((sum, t) => sum + t.count, 0);
  const writeCount = summary.toolBreakdown
    .filter((t) => ["muninn_file_add", "muninn_decision_add", "muninn_learn_add"].includes(t.toolName))
    .reduce((sum, t) => sum + t.count, 0);

  if (queryCount > 10 && writeCount === 0) {
    learnings.push({
      title: "Exploration-only session",
      content: `Session queried ${queryCount} times but made no changes. This context is worth capturing for the next session.`,
      category: "pattern",
      confidence: 0.5,
    });
  }

  return learnings;
}

/**
 * Save extracted learnings to the database.
 * Only saves learnings with confidence >= 0.7.
 */
export async function saveLearnings(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
  learnings: ExtractedLearning[]
): Promise<number> {
  let saved = 0;

  for (const learning of learnings) {
    if (learning.confidence < 0.7) continue;

    try {
      const result = await db.run(
        `INSERT INTO learnings (project_id, category, title, content, source, confidence)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          learning.category,
          learning.title,
          learning.content,
          `session:${sessionId}:auto`,
          Math.round(learning.confidence * 10),
        ]
      );

      // Link to session
      try {
        await db.run(
          `INSERT INTO session_learnings (session_id, learning_id, confidence, auto_applied)
           VALUES (?, ?, ?, 1)`,
          [sessionId, Number(result.lastInsertRowid), learning.confidence]
        );
      } catch {
        // Table might not exist
      }

      saved++;
    } catch {
      // Duplicate or other error
    }
  }

  return saved;
}
