/**
 * Voyage AI Embedding Service
 *
 * Generates 512-dimensional embeddings using voyage-3-lite.
 * Used for embedding memories on store and queries on search.
 */

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite";
const MAX_TEXT_LENGTH = 4096;
const MAX_BATCH_SIZE = 128;

export const EMBEDDING_DIMENSIONS = 512;

interface VoyageResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
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

function getApiKey(): string | null {
  return process.env.VOYAGE_API_KEY ?? null;
}

function truncate(text: string): string {
  return text.length <= MAX_TEXT_LENGTH
    ? text
    : text.substring(0, MAX_TEXT_LENGTH);
}

/**
 * Embed a single text string. Returns 512-dim vector or null on failure.
 */
export async function embed(text: string): Promise<number[] | null> {
  const result = await embedBatch([text]);
  return result?.[0] ?? null;
}

/**
 * Embed multiple texts in one API call. Handles chunking for large batches.
 */
export async function embedBatch(
  texts: string[]
): Promise<number[][] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (texts.length === 0) return [];

  if (texts.length > MAX_BATCH_SIZE) {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const chunk = texts.slice(i, i + MAX_BATCH_SIZE);
      const chunkResult = await embedBatchInternal(apiKey, chunk);
      if (!chunkResult) return null;
      results.push(...chunkResult);
    }
    return results;
  }

  return embedBatchInternal(apiKey, texts);
}

async function embedBatchInternal(
  apiKey: string,
  texts: string[]
): Promise<number[][] | null> {
  const truncated = texts.map(truncate);

  try {
    const response = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: truncated,
        input_type: "document",
      }),
    });

    if (!response.ok) {
      const err = (await response.json()) as VoyageError;
      console.error(
        `[embedder] Voyage API error ${response.status}: ${err.error?.message}`
      );
      return null;
    }

    const data = (await response.json()) as VoyageResponse;
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  } catch (error) {
    console.error("[embedder] Voyage API request failed:", error);
    return null;
  }
}

/**
 * Embed a query string (uses input_type: "query" for better retrieval).
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [truncate(text)],
        input_type: "query",
      }),
    });

    if (!response.ok) {
      const err = (await response.json()) as VoyageError;
      console.error(
        `[embedder] Voyage query error ${response.status}: ${err.error?.message}`
      );
      return null;
    }

    const data = (await response.json()) as VoyageResponse;
    return data.data[0]?.embedding ?? null;
  } catch (error) {
    console.error("[embedder] Voyage query request failed:", error);
    return null;
  }
}

/**
 * Format a vector for pgvector insertion.
 * Converts number[] to "[0.1,0.2,...]" string.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
