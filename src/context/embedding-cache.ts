/**
 * Embedding Cache — In-memory vector cache for fast semantic search
 *
 * Loads top N learnings+decisions by confidence at session start.
 * Cosine similarity scan (<2ms for 500 384-dim vectors).
 * Used by task-analyzer for hybrid FTS+semantic retrieval.
 */

import type { DatabaseAdapter } from "../database/adapter";
import {
  cosineSimilarity,
  deserializeEmbedding,
  generateEmbedding,
  getDimensions,
} from "../embeddings/index";

// ============================================================================
// Types
// ============================================================================

export interface CachedItem {
  id: number;
  type: "learning" | "decision";
  title: string;
  content: string;
  confidence: number;
  embedding: Float32Array;
}

export interface SemanticMatch {
  id: number;
  type: "learning" | "decision";
  title: string;
  content: string;
  confidence: number;
  similarity: number;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_CACHE_SIZE = 500;
const SIMILARITY_THRESHOLD = 0.3;

// ============================================================================
// Module State
// ============================================================================

let cache: CachedItem[] = [];
let cacheWarmed = false;
let warmingInProgress = false;

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Warm the embedding cache from database.
 * Loads top items by confidence that have embeddings.
 * Non-blocking — called at session start.
 */
export async function warmCache(
  db: DatabaseAdapter,
  projectId: number
): Promise<number> {
  if (warmingInProgress) return cache.length;
  warmingInProgress = true;

  try {
    const items: CachedItem[] = [];
    const halfMax = Math.floor(MAX_CACHE_SIZE / 2);

    // Load top learnings with embeddings
    const learnings = await db.all<{
      id: number;
      title: string;
      content: string;
      confidence: number;
      embedding: Buffer | Uint8Array;
    }>(
      `SELECT id, title, content, confidence, embedding FROM learnings
       WHERE (project_id = ? OR project_id IS NULL)
       AND archived_at IS NULL AND embedding IS NOT NULL
       ORDER BY confidence DESC
       LIMIT ?`,
      [projectId, halfMax]
    );

    for (const l of learnings) {
      try {
        const embedding = deserializeEmbedding(l.embedding);
        if (embedding.length === getDimensions()) {
          items.push({
            id: l.id,
            type: "learning",
            title: l.title,
            content: l.content,
            confidence: l.confidence,
            embedding,
          });
        }
      } catch {
        // Skip malformed embeddings
      }
    }

    // Load top decisions with embeddings
    const decisions = await db.all<{
      id: number;
      title: string;
      decision: string;
      embedding: Buffer | Uint8Array;
    }>(
      `SELECT id, title, decision, embedding FROM decisions
       WHERE project_id = ? AND status = 'active' AND embedding IS NOT NULL
       ORDER BY decided_at DESC
       LIMIT ?`,
      [projectId, halfMax]
    );

    for (const d of decisions) {
      try {
        const embedding = deserializeEmbedding(d.embedding);
        if (embedding.length === getDimensions()) {
          items.push({
            id: d.id,
            type: "decision",
            title: d.title,
            content: d.decision,
            confidence: 5, // Decisions don't have confidence — use middle value
            embedding,
          });
        }
      } catch {
        // Skip malformed embeddings
      }
    }

    cache = items;
    cacheWarmed = true;
    return items.length;
  } catch {
    // Tables/columns might not exist
    return 0;
  } finally {
    warmingInProgress = false;
  }
}

/**
 * Find semantically similar items from the cache.
 * Returns matches above similarity threshold, sorted by score.
 */
export async function findSemanticMatches(
  queryText: string,
  maxResults: number = 10
): Promise<SemanticMatch[]> {
  if (cache.length === 0) return [];

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(queryText);
  if (!queryEmbedding) return [];

  // Scan cache for similar items
  const matches: SemanticMatch[] = [];

  for (const item of cache) {
    const similarity = cosineSimilarity(queryEmbedding, item.embedding);
    if (similarity >= SIMILARITY_THRESHOLD) {
      matches.push({
        id: item.id,
        type: item.type,
        title: item.title,
        content: item.content,
        confidence: item.confidence,
        similarity,
      });
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, maxResults);
}

/**
 * Check if the cache has been warmed.
 */
export function isCacheWarmed(): boolean {
  return cacheWarmed;
}

/**
 * Get current cache size.
 */
export function getCacheSize(): number {
  return cache.length;
}

/**
 * Reset cache (for testing).
 */
export function resetCache(): void {
  cache = [];
  cacheWarmed = false;
  warmingInProgress = false;
}
