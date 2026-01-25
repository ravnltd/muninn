/**
 * Vector search queries
 * Semantic similarity search using embeddings
 */

import type { Database } from "bun:sqlite";
import type { QueryResult, QueryResultType } from "../../types";
import {
  cosineSimilarity,
  deserializeEmbedding,
  serializeEmbedding,
  generateEmbedding,
  generateEmbeddings,
  isEmbeddingAvailable,
} from "../../embeddings";
import { reheatEntity } from "../../commands/consolidation";
import { logError } from "../../utils/errors";

// ============================================================================
// Types
// ============================================================================

export interface VectorSearchResult {
  id: number;
  type: QueryResultType;
  title: string;
  content: string | null;
  similarity: number;
}

export interface HybridSearchOptions {
  vectorWeight?: number; // Default: 0.6
  ftsWeight?: number; // Default: 0.4
  limit?: number; // Default: 10
  minSimilarity?: number; // Default: 0.3
}

interface RecordWithEmbedding {
  id: number;
  title: string;
  content: string | null;
  embedding: Buffer | null;
  archived_at: string | null;
}

// ============================================================================
// Check Embedding Coverage
// ============================================================================

interface EmbeddingStats {
  table: string;
  total: number;
  withEmbedding: number;
  coverage: number;
}

/**
 * Get embedding coverage stats for all tables
 */
export function getEmbeddingStats(db: Database, projectId: number): EmbeddingStats[] {
  const tables = ["files", "decisions", "issues", "learnings", "symbols", "observations", "open_questions"];
  const stats: EmbeddingStats[] = [];

  for (const table of tables) {
    try {
      let totalResult: { count: number } | null;
      let withEmbResult: { count: number } | null;

      // Symbols need special handling - they're linked through files
      if (table === "symbols") {
        totalResult = db.query<{ count: number }, [number]>(
          `SELECT COUNT(*) as count FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.project_id = ?`
        ).get(projectId);
        withEmbResult = db.query<{ count: number }, [number]>(
          `SELECT COUNT(*) as count FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.project_id = ? AND s.embedding IS NOT NULL`
        ).get(projectId);
      } else {
        totalResult = db.query<{ count: number }, [number]>(
          `SELECT COUNT(*) as count FROM ${table} WHERE project_id = ?`
        ).get(projectId);
        withEmbResult = db.query<{ count: number }, [number]>(
          `SELECT COUNT(*) as count FROM ${table} WHERE project_id = ? AND embedding IS NOT NULL`
        ).get(projectId);
      }

      const total = totalResult?.count ?? 0;
      const withEmbedding = withEmbResult?.count ?? 0;

      stats.push({
        table,
        total,
        withEmbedding,
        coverage: total > 0 ? Math.round((withEmbedding / total) * 100) : 0,
      });
    } catch (error) {
      logError(`getEmbeddingStats:${table}`, error);
    }
  }

  return stats;
}

/**
 * Check if project has any embeddings
 */
export function hasEmbeddings(db: Database, projectId: number): boolean {
  const stats = getEmbeddingStats(db, projectId);
  return stats.some((s) => s.withEmbedding > 0);
}

// ============================================================================
// Update Embeddings
// ============================================================================

/**
 * Update embedding for a record
 */
export function updateEmbedding(
  db: Database,
  table: string,
  id: number,
  embedding: Float32Array
): void {
  const blob = serializeEmbedding(embedding);
  db.run(`UPDATE ${table} SET embedding = ? WHERE id = ?`, [blob, id]);
}

// ============================================================================
// Vector Search
// ============================================================================

/**
 * Perform vector similarity search across all tables
 */
export async function vectorSearch(
  db: Database,
  query: string,
  projectId: number,
  options: { limit?: number; minSimilarity?: number; tables?: string[] } = {}
): Promise<VectorSearchResult[]> {
  const { limit = 10, minSimilarity = 0.3, tables = ["files", "decisions", "issues", "learnings", "symbols"] } = options;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    return [];
  }

  const results: VectorSearchResult[] = [];

  // Search each table
  for (const table of tables) {
    const tableResults = await searchTable(db, table, queryEmbedding, projectId, minSimilarity);
    results.push(...tableResults);
  }

  // Sort by similarity (descending) and limit
  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Search a single table for similar records
 */
async function searchTable(
  db: Database,
  table: string,
  queryEmbedding: Float32Array,
  projectId: number,
  minSimilarity: number
): Promise<VectorSearchResult[]> {
  try {
    // Get table-specific columns
    const { titleCol, contentCol, type } = getTableMapping(table);

    // Symbols need special handling - they're linked through files
    let records: RecordWithEmbedding[];
    const hasArchived = ["files", "decisions", "issues", "learnings"].includes(table);
    if (table === "symbols") {
      records = db.query<RecordWithEmbedding, [number]>(`
        SELECT s.id, s.${titleCol} as title, s.${contentCol} as content, s.embedding, NULL as archived_at
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.project_id = ? AND s.embedding IS NOT NULL
      `).all(projectId);
    } else {
      const archivedCol = hasArchived ? ", archived_at" : ", NULL as archived_at";
      records = db.query<RecordWithEmbedding, [number]>(`
        SELECT id, ${titleCol} as title, ${contentCol} as content, embedding${archivedCol}
        FROM ${table}
        WHERE project_id = ? AND embedding IS NOT NULL
      `).all(projectId);
    }

    const results: VectorSearchResult[] = [];

    for (const record of records) {
      if (!record.embedding) continue;

      try {
        const embedding = deserializeEmbedding(record.embedding);
        const similarity = cosineSimilarity(queryEmbedding, embedding);

        if (similarity >= minSimilarity) {
          // Re-heat archived items that match vector search
          if (record.archived_at && hasArchived) {
            const tableForReheat = table as "files" | "decisions" | "issues" | "learnings";
            reheatEntity(db, tableForReheat, record.id);
          }

          results.push({
            id: record.id,
            type,
            title: record.title,
            content: record.content,
            similarity,
          });
        }
      } catch (error) {
        logError(`vectorSearch:${table}:${record.id}`, error);
      }
    }

    return results;
  } catch (error) {
    logError(`vectorSearch:${table}`, error);
    return [];
  }
}

/**
 * Get table-specific column mappings
 */
function getTableMapping(table: string): {
  titleCol: string;
  contentCol: string;
  type: QueryResultType;
} {
  switch (table) {
    case "files":
      return { titleCol: "path", contentCol: "purpose", type: "file" };
    case "decisions":
      return { titleCol: "title", contentCol: "decision", type: "decision" };
    case "issues":
      return { titleCol: "title", contentCol: "description", type: "issue" };
    case "learnings":
      return { titleCol: "title", contentCol: "content", type: "learning" };
    case "symbols":
      return { titleCol: "name", contentCol: "signature", type: "symbol" };
    case "observations":
      return { titleCol: "type", contentCol: "content", type: "observation" };
    case "open_questions":
      return { titleCol: "question", contentCol: "context", type: "question" };
    default:
      return { titleCol: "title", contentCol: "content", type: "file" };
  }
}

// ============================================================================
// Hybrid Search (FTS + Vector)
// ============================================================================

/**
 * Perform hybrid search combining FTS and vector similarity
 */
export async function hybridSearch(
  db: Database,
  query: string,
  projectId: number,
  options: HybridSearchOptions = {}
): Promise<QueryResult[]> {
  const {
    vectorWeight = 0.6,
    // ftsWeight is reserved for future hybrid scoring
    limit = 10,
    minSimilarity = 0.3,
  } = options;

  // Check if embeddings are available
  if (!isEmbeddingAvailable() || !hasEmbeddings(db, projectId)) {
    // Fall back to FTS only
    return [];
  }

  // Get vector search results
  const vectorResults = await vectorSearch(db, query, projectId, {
    limit: limit * 2, // Get more candidates for merging
    minSimilarity,
  });

  if (vectorResults.length === 0) {
    return [];
  }

  // Convert to QueryResult format with combined scores
  const results: QueryResult[] = vectorResults.map((vr) => ({
    type: vr.type,
    id: vr.id,
    title: vr.title,
    content: vr.content,
    // Use similarity as relevance (inverted since lower is better in FTS)
    relevance: -(vr.similarity * vectorWeight),
  }));

  return results.slice(0, limit);
}

// ============================================================================
// Backfill Functions
// ============================================================================

interface BackfillRecord {
  id: number;
  text: string;
}

/**
 * Get records that need embeddings for a table
 */
export function getRecordsNeedingEmbeddings(
  db: Database,
  table: string,
  projectId: number
): BackfillRecord[] {
  const { titleCol, contentCol } = getTableMapping(table);

  // Build text representation matching the *ToText() functions (trimmed, no trailing spaces)
  let textExpr: string;
  switch (table) {
    case "files":
      textExpr = `TRIM(path || ' ' || COALESCE(purpose, ''))`;
      break;
    case "decisions":
      textExpr = `TRIM(title || ' ' || decision || ' ' || COALESCE(reasoning, ''))`;
      break;
    case "issues":
      textExpr = `TRIM(title || ' ' || COALESCE(description, '') || ' ' || COALESCE(workaround, ''))`;
      break;
    case "learnings":
      textExpr = `TRIM(title || ' ' || content || ' ' || COALESCE(context, ''))`;
      break;
    case "observations":
      textExpr = `TRIM(type || ': ' || content)`;
      break;
    case "open_questions":
      textExpr = `TRIM(question || ' ' || COALESCE(context, ''))`;
      break;
    default:
      textExpr = `TRIM(${titleCol} || ' ' || COALESCE(${contentCol}, ''))`;
  }

  // Learnings, observations, and questions allow NULL project_id (global)
  const nullableProjectTables = ['learnings', 'observations', 'open_questions'];
  const whereClause = nullableProjectTables.includes(table)
    ? `(project_id = ? OR project_id IS NULL) AND embedding IS NULL`
    : `project_id = ? AND embedding IS NULL`;

  return db.query<BackfillRecord, [number]>(`
    SELECT id, (${textExpr}) as text
    FROM ${table}
    WHERE ${whereClause}
  `).all(projectId);
}

/**
 * Backfill embeddings for a table
 * Returns number of records updated
 */
export async function backfillTable(
  db: Database,
  table: string,
  projectId: number,
  onProgress?: (current: number, total: number) => void
): Promise<number> {
  if (!isEmbeddingAvailable()) {
    return 0;
  }

  const records = getRecordsNeedingEmbeddings(db, table, projectId);
  if (records.length === 0) {
    return 0;
  }

  let updated = 0;

  // Process in batches for efficiency
  const batchSize = 32;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const texts = batch.map((r) => r.text);

    try {
      const embeddings = await generateEmbeddings(texts);

      if (embeddings) {
        for (let j = 0; j < batch.length; j++) {
          if (embeddings[j]) {
            updateEmbedding(db, table, batch[j].id, embeddings[j]);
            updated++;
          }
        }
      }

      if (onProgress) {
        onProgress(Math.min(i + batchSize, records.length), records.length);
      }
    } catch (error) {
      logError(`backfillTable:${table}`, error);
    }
  }

  return updated;
}

/**
 * Backfill all tables
 */
export async function backfillAll(
  db: Database,
  projectId: number,
  onProgress?: (table: string, current: number, total: number) => void
): Promise<Record<string, number>> {
  const tables = ["files", "decisions", "issues", "learnings", "observations", "open_questions"];
  const results: Record<string, number> = {};

  for (const table of tables) {
    results[table] = await backfillTable(db, table, projectId, (current, total) => {
      if (onProgress) {
        onProgress(table, current, total);
      }
    });
  }

  return results;
}
