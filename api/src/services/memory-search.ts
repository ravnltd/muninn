/**
 * Hybrid Search Service
 *
 * Combines pgvector semantic search, PostgreSQL FTS, and structured filters.
 * Uses Reciprocal Rank Fusion (RRF) to merge rankings from different signals.
 */

import { getDb } from "../db/postgres";
import { embedQuery, toVectorLiteral } from "./embedder";
import type { SearchRequest, ScoredMemory } from "../types";

// ============================================================================
// Constants
// ============================================================================

/** RRF constant k — controls how much rank position matters */
const RRF_K = 60;

/** How many extra candidates to fetch for reranking */
const RERANK_MULTIPLIER = 3;

// ============================================================================
// Types
// ============================================================================

interface SearchCandidate {
  id: string;
  tenant_id: string;
  app_id: string;
  scope: string;
  type: string;
  subtype: string | null;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  confidence: number;
  source: string;
  observed_at: string;
  valid_from: string;
  valid_until: string | null;
  superseded_by: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  vector_rank?: number;
  text_rank?: number;
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Perform hybrid search combining semantic + FTS + structured filters.
 */
export async function searchMemories(
  tenantId: string,
  appId: string,
  request: SearchRequest
): Promise<{ memories: ScoredMemory[]; total: number; has_more: boolean }> {
  const { mode } = request;

  if (mode === "semantic") {
    return semanticSearch(tenantId, appId, request);
  }
  if (mode === "text") {
    return textSearch(tenantId, appId, request);
  }

  // Hybrid: merge semantic + text via RRF
  return hybridSearch(tenantId, appId, request);
}

/**
 * Semantic-only search using pgvector HNSW.
 */
async function semanticSearch(
  tenantId: string,
  appId: string,
  request: SearchRequest
): Promise<{ memories: ScoredMemory[]; total: number; has_more: boolean }> {
  const db = getDb();
  const queryEmbedding = await embedQuery(request.query);

  if (!queryEmbedding) {
    // Fall back to text search if embedding fails
    return textSearch(tenantId, appId, request);
  }

  const vectorLiteral = toVectorLiteral(queryEmbedding);
  const fetchLimit = request.limit + request.offset;

  // Build accessible apps list
  const appIds = [appId, ...(request.include_apps ?? [])];

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
      AND embedding IS NOT NULL
      ${request.scopes ? db`AND scope = ANY(${request.scopes})` : db``}
      ${request.types ? db`AND type = ANY(${request.types})` : db``}
      ${request.subtypes ? db`AND subtype = ANY(${request.subtypes})` : db``}
      ${request.tags ? db`AND tags && ${request.tags}` : db``}
      ${request.min_confidence ? db`AND confidence >= ${request.min_confidence}` : db``}
      ${request.valid_at ? db`AND valid_from <= ${request.valid_at}::timestamptz AND (valid_until IS NULL OR valid_until >= ${request.valid_at}::timestamptz)` : db``}
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${fetchLimit}
  `;

  const sliced = rows.slice(request.offset);
  const memories: ScoredMemory[] = sliced.map((row) => ({
    ...(row as unknown as ScoredMemory),
    relevance: Number((row as Record<string, unknown>).similarity),
  }));

  return {
    memories,
    total: rows.length,
    has_more: rows.length === fetchLimit,
  };
}

/**
 * Text-only search using PostgreSQL FTS.
 */
async function textSearch(
  tenantId: string,
  appId: string,
  request: SearchRequest
): Promise<{ memories: ScoredMemory[]; total: number; has_more: boolean }> {
  const db = getDb();
  const fetchLimit = request.limit + request.offset;
  const appIds = [appId, ...(request.include_apps ?? [])];

  // Convert query to tsquery format
  const rows = await db`
    SELECT
      id, tenant_id, app_id, scope, type, subtype,
      title, content, metadata, confidence, source,
      observed_at::text, valid_from::text, valid_until::text,
      superseded_by, tags,
      created_at::text, updated_at::text, deleted_at::text,
      ts_rank(fts, plainto_tsquery('english', ${request.query})) AS text_score
    FROM memories
    WHERE tenant_id = ${tenantId}
      AND app_id = ANY(${appIds})
      AND deleted_at IS NULL
      AND fts @@ plainto_tsquery('english', ${request.query})
      ${request.scopes ? db`AND scope = ANY(${request.scopes})` : db``}
      ${request.types ? db`AND type = ANY(${request.types})` : db``}
      ${request.subtypes ? db`AND subtype = ANY(${request.subtypes})` : db``}
      ${request.tags ? db`AND tags && ${request.tags}` : db``}
      ${request.min_confidence ? db`AND confidence >= ${request.min_confidence}` : db``}
      ${request.valid_at ? db`AND valid_from <= ${request.valid_at}::timestamptz AND (valid_until IS NULL OR valid_until >= ${request.valid_at}::timestamptz)` : db``}
    ORDER BY text_score DESC
    LIMIT ${fetchLimit}
  `;

  const sliced = rows.slice(request.offset);
  const memories: ScoredMemory[] = sliced.map((row) => ({
    ...(row as unknown as ScoredMemory),
    relevance: Number((row as Record<string, unknown>).text_score),
  }));

  return {
    memories,
    total: rows.length,
    has_more: rows.length === fetchLimit,
  };
}

/**
 * Hybrid search using Reciprocal Rank Fusion (RRF).
 * Fetches candidates from both semantic and text search, then merges rankings.
 */
async function hybridSearch(
  tenantId: string,
  appId: string,
  request: SearchRequest
): Promise<{ memories: ScoredMemory[]; total: number; has_more: boolean }> {
  const db = getDb();
  const queryEmbedding = await embedQuery(request.query);
  const fetchLimit = (request.limit + request.offset) * RERANK_MULTIPLIER;
  const appIds = [appId, ...(request.include_apps ?? [])];

  // Shared filter conditions
  const baseFilters = {
    scopes: request.scopes,
    types: request.types,
    subtypes: request.subtypes,
    tags: request.tags,
    min_confidence: request.min_confidence,
    valid_at: request.valid_at,
  };

  // Fetch text candidates
  const textRows = await db`
    SELECT
      id, tenant_id, app_id, scope, type, subtype,
      title, content, metadata, confidence, source,
      observed_at::text, valid_from::text, valid_until::text,
      superseded_by, tags,
      created_at::text, updated_at::text, deleted_at::text,
      ts_rank(fts, plainto_tsquery('english', ${request.query})) AS text_score
    FROM memories
    WHERE tenant_id = ${tenantId}
      AND app_id = ANY(${appIds})
      AND deleted_at IS NULL
      AND fts @@ plainto_tsquery('english', ${request.query})
      ${baseFilters.scopes ? db`AND scope = ANY(${baseFilters.scopes})` : db``}
      ${baseFilters.types ? db`AND type = ANY(${baseFilters.types})` : db``}
      ${baseFilters.subtypes ? db`AND subtype = ANY(${baseFilters.subtypes})` : db``}
      ${baseFilters.tags ? db`AND tags && ${baseFilters.tags}` : db``}
      ${baseFilters.min_confidence ? db`AND confidence >= ${baseFilters.min_confidence}` : db``}
      ${baseFilters.valid_at ? db`AND valid_from <= ${baseFilters.valid_at}::timestamptz AND (valid_until IS NULL OR valid_until >= ${baseFilters.valid_at}::timestamptz)` : db``}
    ORDER BY text_score DESC
    LIMIT ${fetchLimit}
  `;

  // Build RRF scores map
  const scores = new Map<string, { rrf: number; data: SearchCandidate }>();

  // Add text results with RRF scores
  textRows.forEach((row, rank) => {
    const id = (row as Record<string, unknown>).id as string;
    const existing = scores.get(id);
    const rrfScore = 1 / (RRF_K + rank + 1);
    scores.set(id, {
      rrf: (existing?.rrf ?? 0) + rrfScore,
      data: row as unknown as SearchCandidate,
    });
  });

  // Fetch and merge vector candidates if embedding is available
  if (queryEmbedding) {
    const vectorLiteral = toVectorLiteral(queryEmbedding);
    const vectorRows = await db`
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
        AND embedding IS NOT NULL
        ${baseFilters.scopes ? db`AND scope = ANY(${baseFilters.scopes})` : db``}
        ${baseFilters.types ? db`AND type = ANY(${baseFilters.types})` : db``}
        ${baseFilters.subtypes ? db`AND subtype = ANY(${baseFilters.subtypes})` : db``}
        ${baseFilters.tags ? db`AND tags && ${baseFilters.tags}` : db``}
        ${baseFilters.min_confidence ? db`AND confidence >= ${baseFilters.min_confidence}` : db``}
        ${baseFilters.valid_at ? db`AND valid_from <= ${baseFilters.valid_at}::timestamptz AND (valid_until IS NULL OR valid_until >= ${baseFilters.valid_at}::timestamptz)` : db``}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${fetchLimit}
    `;

    vectorRows.forEach((row, rank) => {
      const id = (row as Record<string, unknown>).id as string;
      const existing = scores.get(id);
      const rrfScore = 1 / (RRF_K + rank + 1);
      scores.set(id, {
        rrf: (existing?.rrf ?? 0) + rrfScore,
        data: existing?.data ?? (row as unknown as SearchCandidate),
      });
    });
  }

  // Sort by combined RRF score
  const ranked = Array.from(scores.values())
    .sort((a, b) => b.rrf - a.rrf)
    .slice(request.offset, request.offset + request.limit);

  const memories: ScoredMemory[] = ranked.map(({ rrf, data }) => ({
    id: data.id,
    tenant_id: data.tenant_id,
    app_id: data.app_id,
    scope: data.scope,
    type: data.type,
    subtype: data.subtype,
    title: data.title,
    content: data.content,
    metadata: data.metadata,
    confidence: data.confidence,
    source: data.source,
    observed_at: data.observed_at,
    valid_from: data.valid_from,
    valid_until: data.valid_until,
    superseded_by: data.superseded_by,
    tags: data.tags,
    created_at: data.created_at,
    updated_at: data.updated_at,
    deleted_at: data.deleted_at,
    relevance: rrf,
  }));

  return {
    memories,
    total: scores.size,
    has_more: scores.size > request.offset + request.limit,
  };
}
