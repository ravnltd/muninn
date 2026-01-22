/**
 * Voyage AI embedding client
 * Uses voyage-3-lite model (512 dimensions)
 * https://docs.voyageai.com/docs/embeddings
 */

import { logError } from "../utils/errors";
import { isApiKeyAvailable, getApiKey, redactApiKeys } from "../utils/api-keys";

// ============================================================================
// Configuration
// ============================================================================

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite"; // 512 dimensions, cheapest
const VOYAGE_DIMENSIONS = 512;
const MAX_BATCH_SIZE = 128;
const MAX_TEXT_LENGTH = 4096; // Truncate longer texts

// ============================================================================
// Types
// ============================================================================

interface VoyageEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

interface VoyageError {
  error: {
    message: string;
    type: string;
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Check if Voyage API is available (key is set)
 */
export function isAvailable(): boolean {
  return isApiKeyAvailable("voyage");
}

/**
 * Get the configured embedding dimensions
 */
export function getDimensions(): number {
  return VOYAGE_DIMENSIONS;
}

/**
 * Truncate text to fit within Voyage's limits
 */
function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  return text.substring(0, MAX_TEXT_LENGTH);
}

/**
 * Generate embedding for a single text
 * Returns null if API is unavailable or request fails
 */
export async function embed(text: string): Promise<number[] | null> {
  if (!isAvailable()) {
    return null;
  }

  try {
    const result = await embedBatch([text]);
    return result?.[0] ?? null;
  } catch (error) {
    logError("voyage:embed", error);
    return null;
  }
}

/**
 * Generate embeddings for multiple texts (up to 128)
 * Returns null if API is unavailable or request fails
 */
export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (!isAvailable()) {
    return null;
  }

  if (texts.length === 0) {
    return [];
  }

  if (texts.length > MAX_BATCH_SIZE) {
    // Split into chunks and process
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const chunk = texts.slice(i, i + MAX_BATCH_SIZE);
      const chunkResults = await embedBatchInternal(chunk);
      if (!chunkResults) {
        return null;
      }
      results.push(...chunkResults);
    }
    return results;
  }

  return embedBatchInternal(texts);
}

/**
 * Internal batch embedding (assumes texts.length <= MAX_BATCH_SIZE)
 */
async function embedBatchInternal(texts: string[]): Promise<number[][] | null> {
  const keyResult = getApiKey("voyage");
  if (!keyResult.ok) {
    return null;
  }

  // Truncate texts that are too long
  const truncatedTexts = texts.map(truncateText);

  try {
    const response = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keyResult.value}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: truncatedTexts,
        input_type: "document",
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as VoyageError;
      // Redact any potential key exposure in error message
      const safeMessage = redactApiKeys(errorData.error?.message || response.statusText);
      logError("voyage:embedBatch", new Error(
        `Voyage API error ${response.status}: ${safeMessage}`
      ));
      return null;
    }

    const data = (await response.json()) as VoyageEmbeddingResponse;

    // Sort by index to ensure correct order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  } catch (error) {
    // Ensure no key exposure in logs
    const message = error instanceof Error ? error.message : String(error);
    logError("voyage:embedBatch", new Error(redactApiKeys(message)));
    return null;
  }
}
