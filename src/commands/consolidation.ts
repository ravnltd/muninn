/**
 * Consolidation system
 * Groups cold entities into summary records without deleting originals
 * Cold items are excluded from FTS but remain in vector search
 * Vector match on archived item → re-heats it
 */

import type { Database } from "bun:sqlite";
import { generateEmbedding, serializeEmbedding } from "../embeddings";
import { logError } from "../utils/errors";
import { outputJson } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

type ConsolidatableTable = "files" | "decisions" | "issues" | "learnings";

interface ColdEntity {
  id: number;
  title: string;
  content: string;
  temperature: string | null;
  lastReferencedAt: string | null;
}

interface ConsolidationResult {
  entityType: ConsolidatableTable;
  consolidatedCount: number;
  summaryTitle: string;
}

// ============================================================================
// Temperature Calculation
// ============================================================================

const COLD_SESSION_THRESHOLD = 10;
const MIN_COLD_FOR_CONSOLIDATION = 10;

/**
 * Determine temperature tier based on sessions since last reference
 */
export function getTemperatureTier(sessionsSinceRef: number): string {
  if (sessionsSinceRef <= 3) return "hot";
  if (sessionsSinceRef <= 10) return "warm";
  if (sessionsSinceRef <= 30) return "cold";
  return "archived";
}

// ============================================================================
// Cold Entity Detection
// ============================================================================

/**
 * Get cold entities that haven't been referenced recently
 * Uses session count from last reference to determine coldness
 */
function getColdEntities(
  db: Database,
  projectId: number,
  table: ConsolidatableTable,
  currentSessionNumber: number
): ColdEntity[] {
  const titleCol = table === "files" ? "path" : "title";
  const contentCol =
    table === "files" ? "purpose" : table === "decisions" ? "decision" : table === "issues" ? "description" : "content";

  try {
    return db
      .query<ColdEntity, [number, number]>(`
      SELECT id, ${titleCol} as title, COALESCE(${contentCol}, '') as content,
             temperature, last_referenced_at as lastReferencedAt
      FROM ${table}
      WHERE project_id = ?
        AND archived_at IS NULL
        AND (temperature = 'cold' OR temperature IS NULL)
        AND (
          last_referenced_at IS NULL
          OR (
            CAST(? - COALESCE(
              (SELECT MAX(session_number) FROM sessions WHERE project_id = ${table}.project_id
                AND started_at <= ${table}.last_referenced_at),
              0
            ) AS INTEGER) >= ${COLD_SESSION_THRESHOLD}
          )
        )
      ORDER BY last_referenced_at ASC NULLS FIRST
    `)
      .all(projectId, currentSessionNumber);
  } catch (error) {
    logError(`consolidation:getCold:${table}`, error);
    return [];
  }
}

// ============================================================================
// Consolidation Logic
// ============================================================================

/**
 * Generate a summary for a group of entities
 * Uses simple concatenation when no LLM available
 */
function generateSummary(entities: ColdEntity[], entityType: string): { title: string; content: string } {
  const titles = entities.map((e) => e.title).filter(Boolean);

  const title = `Consolidated ${entityType} (${entities.length} items): ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? "..." : ""}`;

  const contentParts = entities.map((e, i) => {
    const entryTitle = e.title || `Item ${i + 1}`;
    const entryContent = e.content ? `: ${e.content.substring(0, 200)}` : "";
    return `- ${entryTitle}${entryContent}`;
  });

  const content = contentParts.join("\n");

  return { title, content };
}

/**
 * Consolidate cold entities of a given type
 * Returns the consolidation result or null if nothing to consolidate
 */
async function consolidateTable(
  db: Database,
  projectId: number,
  table: ConsolidatableTable,
  currentSessionNumber: number
): Promise<ConsolidationResult | null> {
  const coldEntities = getColdEntities(db, projectId, table, currentSessionNumber);

  if (coldEntities.length < MIN_COLD_FOR_CONSOLIDATION) {
    return null;
  }

  // Group into batches of ~10 for each consolidation record
  const batchSize = 10;
  const results: ConsolidationResult[] = [];

  for (let i = 0; i < coldEntities.length; i += batchSize) {
    const batch = coldEntities.slice(i, i + batchSize);
    const { title, content } = generateSummary(batch, table);
    const sourceIds = batch.map((e) => e.id);

    // Generate embedding for the summary
    let embeddingBlob: Buffer | null = null;
    try {
      const embedding = await generateEmbedding(`${title} ${content}`);
      if (embedding) {
        embeddingBlob = serializeEmbedding(embedding);
      }
    } catch {
      /* embedding optional */
    }

    // Create consolidation record
    const insertResult = db.run(
      `INSERT INTO consolidations (project_id, entity_type, source_ids, summary_title, summary_content, entity_count, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [projectId, table, JSON.stringify(sourceIds), title, content, batch.length, embeddingBlob]
    );

    const consolidationId = Number(insertResult.lastInsertRowid);

    // Archive source entities
    const now = new Date().toISOString();
    const idPlaceholders = sourceIds.map(() => "?").join(",");
    db.run(`UPDATE ${table} SET archived_at = ?, consolidated_into = ? WHERE id IN (${idPlaceholders})`, [
      now,
      consolidationId,
      ...sourceIds,
    ]);

    results.push({
      entityType: table,
      consolidatedCount: batch.length,
      summaryTitle: title,
    });
  }

  return results.length > 0 ? results[0] : null;
}

// ============================================================================
// Re-heat Logic
// ============================================================================

/**
 * Re-heat an archived entity when it's matched by vector search
 * Sets archived_at = NULL and temperature = 'warm'
 */
export function reheatEntity(db: Database, table: ConsolidatableTable, id: number): void {
  try {
    db.run(
      `UPDATE ${table} SET archived_at = NULL, temperature = 'warm', last_referenced_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  } catch (error) {
    logError(`consolidation:reheat:${table}:${id}`, error);
  }
}

// ============================================================================
// Signal-based Trigger
// ============================================================================

/**
 * Check if consolidation should run (signal-based, called on session start)
 * Returns true if there are enough cold entities to warrant consolidation
 */
export function shouldConsolidate(db: Database, projectId: number): boolean {
  const tables: ConsolidatableTable[] = ["files", "decisions", "issues", "learnings"];

  for (const table of tables) {
    try {
      const result = db
        .query<{ count: number }, [number]>(`
        SELECT COUNT(*) as count FROM ${table}
        WHERE project_id = ?
          AND archived_at IS NULL
          AND (temperature = 'cold' OR temperature IS NULL)
      `)
        .get(projectId);

      if (result && result.count >= MIN_COLD_FOR_CONSOLIDATION) {
        return true;
      }
    } catch {
      /* continue */
    }
  }

  return false;
}

/**
 * Run consolidation across all tables
 */
export async function runConsolidation(db: Database, projectId: number): Promise<ConsolidationResult[]> {
  // Get current session number
  const sessionRow = db
    .query<{ session_number: number | null }, [number]>(`
    SELECT MAX(session_number) as session_number FROM sessions WHERE project_id = ?
  `)
    .get(projectId);
  const currentSession = sessionRow?.session_number ?? 0;

  const tables: ConsolidatableTable[] = ["files", "decisions", "issues", "learnings"];
  const results: ConsolidationResult[] = [];

  for (const table of tables) {
    const result = await consolidateTable(db, projectId, table, currentSession);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleConsolidationCommand(db: Database, projectId: number, args: string[]): Promise<void> {
  const subCmd = args[0] || "status";

  switch (subCmd) {
    case "status": {
      const tables: ConsolidatableTable[] = ["files", "decisions", "issues", "learnings"];
      console.error("\n📦 Consolidation Status\n");

      for (const table of tables) {
        const coldResult = db
          .query<{ count: number }, [number]>(`
          SELECT COUNT(*) as count FROM ${table}
          WHERE project_id = ? AND archived_at IS NULL AND (temperature = 'cold' OR temperature IS NULL)
        `)
          .get(projectId);

        const archivedResult = db
          .query<{ count: number }, [number]>(`
          SELECT COUNT(*) as count FROM ${table}
          WHERE project_id = ? AND archived_at IS NOT NULL
        `)
          .get(projectId);

        const coldCount = coldResult?.count ?? 0;
        const archivedCount = archivedResult?.count ?? 0;

        console.error(`  ${table}: ${coldCount} cold, ${archivedCount} archived`);
      }

      const consolidationCount = db
        .query<{ count: number }, [number]>("SELECT COUNT(*) as count FROM consolidations WHERE project_id = ?")
        .get(projectId);

      console.error(`\n  Total consolidation summaries: ${consolidationCount?.count ?? 0}`);
      console.error(`  Threshold: ${MIN_COLD_FOR_CONSOLIDATION} cold items triggers consolidation`);
      console.error("");

      const ready = shouldConsolidate(db, projectId);
      if (ready) {
        console.error("  ⚡ Ready for consolidation. Run: muninn consolidate run");
      } else {
        console.error("  ✅ No consolidation needed yet.");
      }
      console.error("");
      break;
    }

    case "run": {
      console.error("\n🔄 Running consolidation...\n");
      const results = await runConsolidation(db, projectId);

      if (results.length === 0) {
        console.error("  No entities to consolidate.");
      } else {
        for (const r of results) {
          console.error(`  ✅ ${r.entityType}: consolidated ${r.consolidatedCount} items`);
          console.error(`     "${r.summaryTitle}"`);
        }
      }
      console.error("");

      outputJson({ consolidations: results });
      break;
    }

    case "list": {
      const rows = db
        .query<
          {
            id: number;
            entity_type: string;
            summary_title: string;
            entity_count: number;
            created_at: string;
          },
          [number]
        >(
          "SELECT id, entity_type, summary_title, entity_count, created_at FROM consolidations WHERE project_id = ? ORDER BY created_at DESC LIMIT 20"
        )
        .all(projectId);

      if (rows.length === 0) {
        console.error("\nNo consolidation records yet.");
      } else {
        console.error(`\n📦 Consolidation Records (${rows.length})\n`);
        for (const row of rows) {
          console.error(`  [${row.id}] ${row.entity_type} (${row.entity_count} items) — ${row.summary_title}`);
        }
      }
      console.error("");

      outputJson({ consolidations: rows });
      break;
    }

    default:
      console.error(`Usage: muninn consolidate <status|run|list>`);
  }
}
