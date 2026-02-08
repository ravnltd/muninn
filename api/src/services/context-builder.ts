/**
 * Context Builder Service
 *
 * The centerpiece of the Memory API. Assembles relevant memories into
 * a formatted context block ready for injection into Claude API calls.
 *
 * Pipeline:
 * 1. Embed prompt via Voyage AI
 * 2. Retrieve top-N candidates via pgvector
 * 3. Apply structured filters (scope, type, tags, temporal)
 * 4. Score by: similarity (0.5) + recency (0.2) + confidence (0.2) + diversity (0.1)
 * 5. Pack into token budget (greedy knapsack)
 * 6. Format output (XML, markdown, native, JSON)
 */

import { getDb } from "../db/postgres";
import { embedQuery, toVectorLiteral } from "./embedder";
import type { ContextRequest, Memory } from "../types";

// ============================================================================
// Constants
// ============================================================================

/** Rough estimate: 1 token ≈ 4 chars for English text */
const CHARS_PER_TOKEN = 4;

/** Fetch more candidates than needed for scoring headroom */
const CANDIDATE_MULTIPLIER = 5;

/** Maximum candidates to consider */
const MAX_CANDIDATES = 200;

// ============================================================================
// Types
// ============================================================================

interface ScoredCandidate {
  memory: Memory;
  similarity: number;
  score: number;
  estimatedTokens: number;
}

interface ContextResult {
  context: string;
  memories_used: Array<{
    id: string;
    type: string;
    title: string;
    relevance: number;
  }>;
  token_count: number;
  total_candidates: number;
  latency_ms: number;
}

// ============================================================================
// Token Estimation
// ============================================================================

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ============================================================================
// Scoring
// ============================================================================

interface ScoreWeights {
  similarity: number;
  recency: number;
  confidence: number;
  diversity: number;
}

const STRATEGY_WEIGHTS: Record<string, ScoreWeights> = {
  balanced: { similarity: 0.5, recency: 0.2, confidence: 0.2, diversity: 0.1 },
  precise: { similarity: 0.7, recency: 0.1, confidence: 0.15, diversity: 0.05 },
  broad: { similarity: 0.3, recency: 0.2, confidence: 0.2, diversity: 0.3 },
};

/**
 * Score a candidate memory for context relevance.
 */
function scoreCandidate(
  memory: Memory,
  similarity: number,
  weights: ScoreWeights,
  seenTypes: Set<string>
): number {
  // Similarity score (0-1, from vector distance)
  const simScore = similarity;

  // Recency score (exponential decay over 90 days)
  const ageMs = Date.now() - new Date(memory.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp(-ageDays / 90);

  // Confidence score (already 0-1)
  const confScore = memory.confidence;

  // Diversity bonus (reward types not yet represented)
  const diversityScore = seenTypes.has(memory.type) ? 0 : 1;

  return (
    weights.similarity * simScore +
    weights.recency * recencyScore +
    weights.confidence * confScore +
    weights.diversity * diversityScore
  );
}

// ============================================================================
// Context Assembly
// ============================================================================

/**
 * Build a context block for a given prompt.
 */
export async function buildContext(
  tenantId: string,
  appId: string,
  request: ContextRequest
): Promise<ContextResult> {
  const startTime = Date.now();
  const db = getDb();

  // 1. Embed the prompt
  const queryEmbedding = await embedQuery(request.prompt);
  const appIds = [appId, ...(request.include_apps ?? [])];

  // 2. Retrieve candidates
  const candidateLimit = Math.min(
    request.max_tokens * CANDIDATE_MULTIPLIER,
    MAX_CANDIDATES
  );

  let candidates: Array<Memory & { similarity: number }>;

  if (queryEmbedding) {
    const vectorLiteral = toVectorLiteral(queryEmbedding);
    const filters = request.filters;

    const rows = await db`
      SELECT
        id, tenant_id, app_id, scope, type, subtype,
        title, content, metadata, confidence, source,
        observed_at::text, valid_from::text, valid_until::text,
        superseded_by, tags,
        created_at::text, updated_at::text, deleted_at::text,
        1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM memories
      WHERE tenant_id = ${tenantId}
        AND app_id = ANY(${appIds})
        AND deleted_at IS NULL
        AND superseded_by IS NULL
        AND embedding IS NOT NULL
        ${request.scopes ? db`AND scope = ANY(${request.scopes})` : db``}
        ${filters?.types ? db`AND type = ANY(${filters.types})` : db``}
        ${filters?.subtypes ? db`AND subtype = ANY(${filters.subtypes})` : db``}
        ${filters?.tags ? db`AND tags && ${filters.tags}` : db``}
        ${filters?.min_confidence ? db`AND confidence >= ${filters.min_confidence}` : db``}
        ${filters?.valid_at
          ? db`AND valid_from <= ${filters.valid_at}::timestamptz
               AND (valid_until IS NULL OR valid_until >= ${filters.valid_at}::timestamptz)`
          : db`AND (valid_until IS NULL OR valid_until >= NOW())`}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${candidateLimit}
    `;

    candidates = rows as unknown as Array<Memory & { similarity: number }>;
  } else {
    // Fallback to FTS if embedding fails
    const filters = request.filters;
    const rows = await db`
      SELECT
        id, tenant_id, app_id, scope, type, subtype,
        title, content, metadata, confidence, source,
        observed_at::text, valid_from::text, valid_until::text,
        superseded_by, tags,
        created_at::text, updated_at::text, deleted_at::text,
        ts_rank(fts, plainto_tsquery('english', ${request.prompt})) AS similarity
      FROM memories
      WHERE tenant_id = ${tenantId}
        AND app_id = ANY(${appIds})
        AND deleted_at IS NULL
        AND superseded_by IS NULL
        AND fts @@ plainto_tsquery('english', ${request.prompt})
        ${request.scopes ? db`AND scope = ANY(${request.scopes})` : db``}
        ${filters?.types ? db`AND type = ANY(${filters.types})` : db``}
        ${filters?.subtypes ? db`AND subtype = ANY(${filters.subtypes})` : db``}
        ${filters?.tags ? db`AND tags && ${filters.tags}` : db``}
        ${filters?.min_confidence ? db`AND confidence >= ${filters.min_confidence}` : db``}
        ${filters?.valid_at
          ? db`AND valid_from <= ${filters.valid_at}::timestamptz
               AND (valid_until IS NULL OR valid_until >= ${filters.valid_at}::timestamptz)`
          : db`AND (valid_until IS NULL OR valid_until >= NOW())`}
      ORDER BY similarity DESC
      LIMIT ${candidateLimit}
    `;

    candidates = rows as unknown as Array<Memory & { similarity: number }>;
  }

  const totalCandidates = candidates.length;

  // 3. Score candidates
  const weights = STRATEGY_WEIGHTS[request.strategy] ?? STRATEGY_WEIGHTS.balanced;
  const seenTypes = new Set<string>();

  const scored: ScoredCandidate[] = candidates.map((c) => {
    const score = scoreCandidate(c, c.similarity, weights, seenTypes);
    seenTypes.add(c.type);

    const contentForTokens = formatMemoryForEstimate(c, request.format);
    return {
      memory: c,
      similarity: c.similarity,
      score,
      estimatedTokens: estimateTokens(contentForTokens),
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // 4. Greedy knapsack — pack into token budget
  const selected: ScoredCandidate[] = [];
  let tokenBudget = request.max_tokens;

  // Reserve tokens for formatting overhead (wrapper tags, etc.)
  const overhead = request.format === "xml" ? 100 : 50;
  tokenBudget -= overhead;

  for (const candidate of scored) {
    if (tokenBudget <= 0) break;
    if (candidate.estimatedTokens <= tokenBudget) {
      selected.push(candidate);
      tokenBudget -= candidate.estimatedTokens;
    }
  }

  // 5. Format output
  const context = formatContext(selected, appId, request);
  const tokenCount = estimateTokens(context);

  // 6. Log context request (fire and forget)
  logContextRequest(db, tenantId, appId, request.prompt, selected, totalCandidates, tokenCount, Date.now() - startTime);

  return {
    context,
    memories_used: selected.map((s) => ({
      id: s.memory.id,
      type: s.memory.type,
      title: s.memory.title,
      relevance: Math.round(s.score * 1000) / 1000,
    })),
    token_count: tokenCount,
    total_candidates: totalCandidates,
    latency_ms: Date.now() - startTime,
  };
}

// ============================================================================
// Formatting
// ============================================================================

function formatMemoryForEstimate(memory: Memory, format: string): string {
  if (format === "native") {
    return `K[${memory.type}|${memory.title}|conf:${memory.confidence}]`;
  }
  return `${memory.title}: ${memory.content}`;
}

function formatContext(
  selected: ScoredCandidate[],
  appId: string,
  request: ContextRequest
): string {
  if (selected.length === 0) {
    return request.format === "xml"
      ? `<muninn-context app="${appId}" tokens="0" />`
      : "";
  }

  switch (request.format) {
    case "xml":
      return formatXml(selected, appId, request.scopes);
    case "markdown":
      return formatMarkdown(selected);
    case "native":
      return formatNative(selected);
    case "json":
      return formatJson(selected);
    default:
      return formatXml(selected, appId, request.scopes);
  }
}

function formatXml(
  selected: ScoredCandidate[],
  appId: string,
  scopes?: string[]
): string {
  const scopeAttr = scopes?.length === 1 ? ` scope="${escapeXml(scopes[0])}"` : "";
  const tokenCount = selected.reduce((sum, s) => sum + s.estimatedTokens, 0);

  const items = selected.map((s) => {
    const m = s.memory;
    const subtypeAttr = m.subtype ? ` subtype="${escapeXml(m.subtype)}"` : "";
    const conf = Math.round(m.confidence * 100) / 100;
    return `  <${escapeXml(m.type)}${subtypeAttr} confidence="${conf}">${escapeXml(m.content)}</${escapeXml(m.type)}>`;
  });

  return [
    `<muninn-context app="${escapeXml(appId)}"${scopeAttr} tokens="${tokenCount}">`,
    ...items,
    `</muninn-context>`,
  ].join("\n");
}

function formatMarkdown(selected: ScoredCandidate[]): string {
  const lines = ["## Relevant Context"];
  for (const s of selected) {
    const m = s.memory;
    const conf = Math.round(m.confidence * 100) / 100;
    const typeLabel = m.subtype ? `${m.type}.${m.subtype}` : m.type;
    lines.push(`- **[${typeLabel}, ${conf}]** ${m.content}`);
  }
  return lines.join("\n");
}

function formatNative(selected: ScoredCandidate[]): string {
  return selected
    .map((s) => {
      const m = s.memory;
      const conf = Math.round(m.confidence * 10);
      const entities = m.tags.length > 0 ? `|ent:${m.tags.slice(0, 3).join(",")}` : "";
      return `K[${m.type}${entities}|${m.title}|conf:${conf}]`;
    })
    .join("\n");
}

function formatJson(selected: ScoredCandidate[]): string {
  const items = selected.map((s) => ({
    id: s.memory.id,
    type: s.memory.type,
    subtype: s.memory.subtype,
    title: s.memory.title,
    content: s.memory.content,
    confidence: s.memory.confidence,
    relevance: Math.round(s.score * 1000) / 1000,
    tags: s.memory.tags,
  }));
  return JSON.stringify(items);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// Logging
// ============================================================================

function logContextRequest(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  appId: string,
  prompt: string,
  selected: ScoredCandidate[],
  totalCandidates: number,
  tokenCount: number,
  latencyMs: number
): void {
  // Hash the prompt — don't store raw prompts
  crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(prompt))
    .then((hash) => {
      const promptHash = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");

      const memoryIds = selected.map((s) => s.memory.id);

      return db`
        INSERT INTO context_log (
          tenant_id, app_id, prompt_hash,
          memories_returned, total_candidates, token_count, latency_ms
        ) VALUES (
          ${tenantId}, ${appId}, ${promptHash},
          ${memoryIds}, ${totalCandidates}, ${tokenCount}, ${latencyMs}
        )
      `;
    })
    .catch(() => {
      // Fire and forget — don't fail the request over logging
    });
}
