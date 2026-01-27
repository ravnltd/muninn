/**
 * Query and search commands
 * Semantic search across project knowledge
 */

import type { DatabaseAdapter } from "../database/adapter";
import { closeGlobalDb, getGlobalDb } from "../database/connection";
import { searchGlobalLearnings, semanticQuery } from "../database/queries/search";
import type { QueryResult } from "../types";
import { getApiKey, redactApiKeys } from "../utils/api-keys";
import { logError } from "../utils/errors";
import { outputJson } from "../utils/format";

// ============================================================================
// Semantic Query with Global Learning Integration
// ============================================================================

export async function handleQueryCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const useSmartQuery = args.includes("--smart");
  const useVectorOnly = args.includes("--vector");
  const useFtsOnly = args.includes("--fts");
  const useBrief = args.includes("--brief");
  const queryTerms = args.filter((a) => !a.startsWith("--")).join(" ");

  if (!queryTerms) {
    console.error("Usage: muninn query <text> [--smart] [--vector] [--fts] [--brief]");
    console.error("");
    console.error("Options:");
    console.error("  --smart    Use LLM re-ranking for better relevance");
    console.error("  --vector   Use vector similarity search only");
    console.error("  --fts      Use full-text search only (default without embeddings)");
    console.error("  --brief    Return concise summaries instead of full content");
    process.exit(1);
  }

  // Determine search mode
  let mode: "auto" | "fts" | "vector" | "hybrid" = "auto";
  if (useVectorOnly) {
    mode = "vector";
    console.error("🔍 Using vector similarity search...\n");
  } else if (useFtsOnly) {
    mode = "fts";
    console.error("🔍 Using full-text search...\n");
  }

  if (useSmartQuery) {
    console.error("🧠 Using LLM re-ranking for semantic search...\n");
    try {
      const results = await semanticQueryWithReranking(db, queryTerms, projectId);
      displayQueryResults(results, useBrief);
      outputJson(useBrief ? toBriefResults(results) : results);
    } catch (error) {
      logError("smartQuery", error);
      // Fall back to regular query
      const results = await performSemanticQuery(db, queryTerms, projectId, mode);
      displayQueryResults(results, useBrief);
      outputJson(useBrief ? toBriefResults(results) : results);
    }
  } else {
    const results = await performSemanticQuery(db, queryTerms, projectId, mode);
    displayQueryResults(results, useBrief);
    outputJson(useBrief ? toBriefResults(results) : results);
  }
}

// ============================================================================
// Perform Semantic Query
// ============================================================================

async function performSemanticQuery(
  db: DatabaseAdapter,
  query: string,
  projectId: number,
  mode: "auto" | "fts" | "vector" | "hybrid" = "auto"
): Promise<QueryResult[]> {
  const results = await semanticQuery(db, query, projectId, { mode });

  // Also search global learnings (only for fts/auto modes)
  if (mode !== "vector") {
    try {
      const globalDb = await getGlobalDb();
      const globalLearnings = await searchGlobalLearnings(globalDb, query);
      results.push(
        ...globalLearnings.map((l) => ({
          id: l.id,
          title: l.title,
          content: l.content,
          relevance: -0.5, // Boost global learnings
          type: "global-learning" as const,
        }))
      );
      closeGlobalDb();
    } catch (error) {
      logError("performSemanticQuery:global", error);
    }
  }

  return results.sort((a, b) => a.relevance - b.relevance).slice(0, 10);
}

// ============================================================================
// Display Query Results
// ============================================================================

function displayQueryResults(results: QueryResult[], brief = false): void {
  if (results.length === 0) {
    console.error("No results found. Try different search terms or run `muninn analyze` first.");
    return;
  }

  console.error(`\n🔍 Found ${results.length} result(s):\n`);

  for (const result of results) {
    const typeIcon = getTypeIcon(result.type);

    if (brief) {
      // Brief mode: one line per result
      const summary = getBriefSummary(result);
      console.error(`${typeIcon} ${result.title} — ${summary}`);
    } else {
      // Full mode: show content preview
      const content = result.content?.substring(0, 100) || "";
      const ellipsis = (result.content?.length || 0) > 100 ? "..." : "";

      console.error(`${typeIcon} [${result.type}] ${result.title}`);
      if (content) {
        console.error(`   ${content}${ellipsis}`);
      }
      console.error("");
    }
  }
}

// ============================================================================
// Brief Output Helpers
// ============================================================================

interface BriefResult {
  type: string;
  id: number;
  title: string;
  summary: string;
}

function getBriefSummary(result: QueryResult): string {
  switch (result.type) {
    case "file":
      return `fragility ${result.relevance ? Math.abs(result.relevance * 10).toFixed(0) : "?"}`;
    case "decision":
      return result.content?.substring(0, 40) || "decision";
    case "issue":
      return result.content?.substring(0, 40) || "issue";
    case "learning":
    case "global-learning":
      return result.content?.substring(0, 40) || "learning";
    default:
      return result.content?.substring(0, 40) || "";
  }
}

function toBriefResults(results: QueryResult[]): BriefResult[] {
  return results.map((r) => ({
    type: r.type,
    id: r.id,
    title: r.title,
    summary: getBriefSummary(r),
  }));
}

function getTypeIcon(type: string): string {
  switch (type) {
    case "file":
      return "📁";
    case "decision":
      return "📋";
    case "issue":
      return "🐛";
    case "learning":
    case "global-learning":
      return "💡";
    default:
      return "📄";
  }
}

// ============================================================================
// Smart Query with LLM Re-ranking
// ============================================================================

async function semanticQueryWithReranking(db: DatabaseAdapter, query: string, projectId: number): Promise<QueryResult[]> {
  // Stage 1: Get candidates using FTS5
  const candidates = await performSemanticQuery(db, query, projectId, "fts");

  if (candidates.length <= 3) {
    return candidates; // Not enough to rerank
  }

  // Stage 2: Use LLM to rerank
  try {
    const candidateList = candidates
      .map((c: QueryResult, i: number) => `[${i}] ${c.type}: ${c.title} - ${c.content?.substring(0, 100) || ""}...`)
      .join("\n");

    const prompt = `You are ranking search results for relevance to a query.

Query: "${query}"

Candidates (indexed 0-${candidates.length - 1}):
${candidateList}

Return ONLY a JSON array of indices in order of relevance (most relevant first).
Example: [3, 0, 2, 1, 4]`;

    const response = await callLLM(prompt, 200);
    const rankedIndices = parseJsonResponse(response);

    if (Array.isArray(rankedIndices)) {
      const reranked: QueryResult[] = [];
      for (const idx of rankedIndices) {
        if (typeof idx === "number" && idx >= 0 && idx < candidates.length) {
          reranked.push(candidates[idx]);
        }
      }
      // Add any candidates that weren't ranked
      for (const c of candidates) {
        if (!reranked.includes(c)) {
          reranked.push(c);
        }
      }
      return reranked;
    }
  } catch (error) {
    logError("semanticQueryWithReranking", error);
  }

  return candidates;
}

// ============================================================================
// LLM API Helper
// ============================================================================

async function callLLM(prompt: string, maxTokens: number = 2000): Promise<string> {
  const keyResult = getApiKey("anthropic");
  if (!keyResult.ok) {
    throw new Error(keyResult.error.message);
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": keyResult.value,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${redactApiKeys(errorText)}`);
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    return data.content[0]?.text || "";
  } catch (error) {
    // Ensure no key exposure in error messages
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactApiKeys(message));
  }
}

function parseJsonResponse(text: string): unknown {
  // Extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    // Try to find array in text
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
    throw new Error("Could not parse JSON response");
  }
}
