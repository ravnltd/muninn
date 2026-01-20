/**
 * Query and search commands
 * Semantic search across project knowledge
 */

import type { Database } from "bun:sqlite";
import type { QueryResult } from "../types";
import { semanticQuery, searchGlobalLearnings } from "../database/queries/search";
import { getGlobalDb, closeGlobalDb } from "../database/connection";
import { outputJson } from "../utils/format";
import { logError } from "../utils/errors";

// ============================================================================
// Semantic Query with Global Learning Integration
// ============================================================================

export async function handleQueryCommand(db: Database, projectId: number, args: string[]): Promise<void> {
  const useSmartQuery = args.includes("--smart");
  const useVectorOnly = args.includes("--vector");
  const useFtsOnly = args.includes("--fts");
  const queryTerms = args.filter(a => !a.startsWith("--")).join(" ");

  if (!queryTerms) {
    console.error("Usage: context query <text> [--smart] [--vector] [--fts]");
    console.error("");
    console.error("Options:");
    console.error("  --smart    Use Claude re-ranking for better relevance");
    console.error("  --vector   Use vector similarity search only");
    console.error("  --fts      Use full-text search only (default without embeddings)");
    process.exit(1);
  }

  // Determine search mode
  let mode: 'auto' | 'fts' | 'vector' | 'hybrid' = 'auto';
  if (useVectorOnly) {
    mode = 'vector';
    console.error("🔍 Using vector similarity search...\n");
  } else if (useFtsOnly) {
    mode = 'fts';
    console.error("🔍 Using full-text search...\n");
  }

  if (useSmartQuery) {
    console.error("🧠 Using Claude re-ranking for semantic search...\n");
    try {
      const results = await semanticQueryWithReranking(db, queryTerms, projectId);
      displayQueryResults(results);
      outputJson(results);
    } catch (error) {
      logError('smartQuery', error);
      // Fall back to regular query
      const results = await performSemanticQuery(db, queryTerms, projectId, mode);
      displayQueryResults(results);
      outputJson(results);
    }
  } else {
    const results = await performSemanticQuery(db, queryTerms, projectId, mode);
    displayQueryResults(results);
    outputJson(results);
  }
}

// ============================================================================
// Perform Semantic Query
// ============================================================================

async function performSemanticQuery(
  db: Database,
  query: string,
  projectId: number,
  mode: 'auto' | 'fts' | 'vector' | 'hybrid' = 'auto'
): Promise<QueryResult[]> {
  const results = await semanticQuery(db, query, projectId, { mode });

  // Also search global learnings (only for fts/auto modes)
  if (mode !== 'vector') {
    try {
      const globalDb = getGlobalDb();
      const globalLearnings = searchGlobalLearnings(globalDb, query);
      results.push(...globalLearnings.map(l => ({
        id: l.id,
        title: l.title,
        content: l.content,
        relevance: -0.5, // Boost global learnings
        type: "global-learning" as const,
      })));
      closeGlobalDb();
    } catch (error) {
      logError('performSemanticQuery:global', error);
    }
  }

  return results
    .sort((a, b) => a.relevance - b.relevance)
    .slice(0, 10);
}

// ============================================================================
// Display Query Results
// ============================================================================

function displayQueryResults(results: QueryResult[]): void {
  if (results.length === 0) {
    console.error("No results found. Try different search terms or run `context analyze` first.");
    return;
  }

  console.error(`\n🔍 Found ${results.length} result(s):\n`);

  for (const result of results) {
    const typeIcon = getTypeIcon(result.type);
    const content = result.content?.substring(0, 100) || '';
    const ellipsis = (result.content?.length || 0) > 100 ? '...' : '';

    console.error(`${typeIcon} [${result.type}] ${result.title}`);
    if (content) {
      console.error(`   ${content}${ellipsis}`);
    }
    console.error('');
  }
}

function getTypeIcon(type: string): string {
  switch (type) {
    case 'file':
      return '📁';
    case 'decision':
      return '📋';
    case 'issue':
      return '🐛';
    case 'learning':
    case 'global-learning':
      return '💡';
    default:
      return '📄';
  }
}

// ============================================================================
// Smart Query with Claude Re-ranking
// ============================================================================

async function semanticQueryWithReranking(
  db: Database,
  query: string,
  projectId: number
): Promise<QueryResult[]> {
  // Stage 1: Get candidates using FTS5
  const candidates = await performSemanticQuery(db, query, projectId, 'fts');

  if (candidates.length <= 3) {
    return candidates; // Not enough to rerank
  }

  // Stage 2: Use Claude to rerank
  try {
    const candidateList = candidates.map((c: QueryResult, i: number) =>
      `[${i}] ${c.type}: ${c.title} - ${c.content?.substring(0, 100) || ""}...`
    ).join("\n");

    const prompt = `You are ranking search results for relevance to a query.

Query: "${query}"

Candidates (indexed 0-${candidates.length - 1}):
${candidateList}

Return ONLY a JSON array of indices in order of relevance (most relevant first).
Example: [3, 0, 2, 1, 4]`;

    const response = await callClaude(prompt, 200);
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
    logError('semanticQueryWithReranking', error);
  }

  return candidates;
}

// ============================================================================
// Claude API Helper
// ============================================================================

async function callClaude(prompt: string, maxTokens: number = 2000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.text || "";
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
