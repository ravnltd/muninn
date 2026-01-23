/**
 * Core embedding module
 * Provides embedding generation, serialization, and similarity functions
 */

import * as voyage from "./voyage";
import { logError } from "../utils/errors";

// Re-export voyage functions
export { isAvailable as isVoyageAvailable } from "./voyage";
export { getDimensions } from "./voyage";

// ============================================================================
// Types
// ============================================================================

export type EmbeddingProvider = "voyage" | "disabled";

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embedding for text using configured provider
 * Returns Float32Array for efficient storage/comparison, or null if unavailable
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  if (!voyage.isAvailable()) {
    return null;
  }

  try {
    const embedding = await voyage.embed(text);
    if (!embedding) {
      return null;
    }
    return new Float32Array(embedding);
  } catch (error) {
    logError("embeddings:generate", error);
    return null;
  }
}

/**
 * Generate embeddings for multiple texts
 * Returns array of Float32Arrays, or null if unavailable
 */
export async function generateEmbeddings(texts: string[]): Promise<Float32Array[] | null> {
  if (!voyage.isAvailable()) {
    return null;
  }

  try {
    const embeddings = await voyage.embedBatch(texts);
    if (!embeddings) {
      return null;
    }
    return embeddings.map((emb) => new Float32Array(emb));
  } catch (error) {
    logError("embeddings:generateBatch", error);
    return null;
  }
}

// ============================================================================
// Serialization (for SQLite BLOB storage)
// ============================================================================

/**
 * Serialize Float32Array to Buffer for SQLite BLOB storage
 */
export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/**
 * Deserialize Buffer from SQLite BLOB to Float32Array
 */
export function deserializeEmbedding(blob: Buffer | Uint8Array): Float32Array {
  // Handle both Buffer and Uint8Array
  const buffer = blob instanceof Buffer ? blob : Buffer.from(blob);
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

// ============================================================================
// Similarity Functions
// ============================================================================

/**
 * Calculate cosine similarity between two embeddings
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Calculate cosine similarity from raw number arrays
 */
export function cosineSimilarityRaw(a: number[], b: number[]): number {
  return cosineSimilarity(new Float32Array(a), new Float32Array(b));
}

// ============================================================================
// Text Representations for Different Record Types
// ============================================================================

/**
 * Create text representation for file embedding
 */
export function fileToText(path: string, purpose: string | null): string {
  return `${path} ${purpose || ""}`.trim();
}

/**
 * Create text representation for decision embedding
 */
export function decisionToText(
  title: string,
  decision: string,
  reasoning: string | null
): string {
  return `${title} ${decision} ${reasoning || ""}`.trim();
}

/**
 * Create text representation for issue embedding
 */
export function issueToText(
  title: string,
  description: string | null,
  workaround: string | null
): string {
  return `${title} ${description || ""} ${workaround || ""}`.trim();
}

/**
 * Create text representation for learning embedding
 */
export function learningToText(
  title: string,
  content: string,
  context: string | null
): string {
  return `${title} ${content} ${context || ""}`.trim();
}

/**
 * Create text representation for observation embedding
 */
export function observationToText(
  content: string,
  type: string
): string {
  return `${type}: ${content}`.trim();
}

/**
 * Create text representation for open question embedding
 */
export function questionToText(
  question: string,
  context: string | null
): string {
  return `${question} ${context || ""}`.trim();
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if embeddings are available
 */
export function isEmbeddingAvailable(): boolean {
  return voyage.isAvailable();
}

/**
 * Get the current embedding provider
 */
export function getProvider(): EmbeddingProvider {
  if (voyage.isAvailable()) {
    return "voyage";
  }
  return "disabled";
}
