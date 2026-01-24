/**
 * Local embedding provider using Transformers.js
 * Uses ONNX-based all-MiniLM-L6-v2 model (384 dimensions)
 * No API key required — runs fully offline
 */

import { logError } from "../utils/errors";

// ============================================================================
// Configuration
// ============================================================================

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const LOCAL_DIMENSIONS = 384;
const MAX_TEXT_LENGTH = 512; // Model's max sequence length in tokens (~characters/1.3)

// ============================================================================
// Pipeline Management
// ============================================================================

// Use opaque type to avoid complex union type inference
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadingPromise: Promise<any> | null = null;

/**
 * Lazily initialize the feature extraction pipeline
 * Reuses the same instance across calls
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getExtractor(): Promise<any> {
  if (extractor) {
    return extractor;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipe = await pipeline("feature-extraction", MODEL_NAME, {
      dtype: "fp32",
    });
    extractor = pipe;
    return pipe;
  })();

  return loadingPromise;
}

// ============================================================================
// Text Processing
// ============================================================================

/**
 * Truncate text to fit within model's context window
 */
function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  return text.substring(0, MAX_TEXT_LENGTH);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Local embeddings are always available (no API key needed)
 */
export function isAvailable(): boolean {
  return true;
}

/**
 * Get the embedding dimensions for this provider
 */
export function getDimensions(): number {
  return LOCAL_DIMENSIONS;
}

/**
 * Generate embedding for a single text
 * Returns number array or null on failure
 */
export async function embed(text: string): Promise<number[] | null> {
  try {
    const result = await embedBatch([text]);
    return result?.[0] ?? null;
  } catch (error) {
    logError("local:embed", error);
    return null;
  }
}

/**
 * Generate embeddings for multiple texts
 * Returns array of number arrays or null on failure
 */
export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) {
    return [];
  }

  try {
    const pipe = await getExtractor();
    const truncated = texts.map(truncateText);
    const results: number[][] = [];

    // Process individually to avoid memory issues with large batches
    for (const text of truncated) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      // output is a Tensor — extract the underlying typed array
      const data: Float32Array = output.data;
      const embedding = Array.from(data);
      results.push(embedding.slice(0, LOCAL_DIMENSIONS));
    }

    return results;
  } catch (error) {
    logError("local:embedBatch", error);
    return null;
  }
}
