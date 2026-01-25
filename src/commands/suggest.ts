/**
 * Suggest Command
 * Uses semantic/embedding search to find relevant files for a task.
 * Complements `predict` which uses FTS (keyword matching).
 */

import type { Database } from "bun:sqlite";
import { type VectorSearchResult, vectorSearch } from "../database/queries/vector";
import { outputJson } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

export interface SuggestResult {
  files: Array<{
    path: string;
    purpose: string | null;
    similarity: number;
    reason: string;
  }>;
  symbols: Array<{
    name: string;
    file: string;
    signature: string | null;
    similarity: number;
  }>;
  relatedByDeps: Array<{
    path: string;
    relatedTo: string;
    relationship: string;
  }>;
}

export interface SuggestOptions {
  limit?: number;
  includeSymbols?: boolean;
  minSimilarity?: number;
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Suggest files for a task using semantic search
 * Unlike predict (FTS), this finds conceptually related files
 */
export async function suggestFilesForTask(
  db: Database,
  projectId: number,
  task: string,
  options: SuggestOptions = {}
): Promise<SuggestResult> {
  const { limit = 10, includeSymbols = false, minSimilarity = 0.3 } = options;

  const result: SuggestResult = {
    files: [],
    symbols: [],
    relatedByDeps: [],
  };

  // 1. Vector search files table
  const tablesToSearch = includeSymbols ? ["files", "symbols"] : ["files"];
  const vectorResults = await vectorSearch(db, task, projectId, {
    limit: limit * 2, // Get extra to allow filtering
    minSimilarity,
    tables: tablesToSearch,
  });

  // 2. Process results by type
  const fileResults = vectorResults.filter((r) => r.type === "file");
  const symbolResults = vectorResults.filter((r) => r.type === "symbol");

  // 3. Map file results
  result.files = fileResults.slice(0, limit).map((r) => ({
    path: r.title,
    purpose: r.content,
    similarity: Math.round(r.similarity * 100) / 100,
    reason: generateReason(r.similarity, r.content),
  }));

  // 4. Map symbol results (if requested)
  if (includeSymbols && symbolResults.length > 0) {
    // Get file paths for symbols
    const symbolsWithFiles = await getSymbolFiles(db, symbolResults);
    result.symbols = symbolsWithFiles.slice(0, Math.ceil(limit / 2));
  }

  // 5. Get blast radius dependents for top 3 files
  if (result.files.length > 0) {
    const topFiles = result.files.slice(0, 3).map((f) => f.path);
    result.relatedByDeps = getBlastDependents(db, projectId, topFiles);
  }

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a human-readable reason for the suggestion
 */
function generateReason(similarity: number, purpose: string | null): string {
  const strength = similarity >= 0.7 ? "Strongly" : similarity >= 0.5 ? "Moderately" : "Loosely";

  if (purpose) {
    return `${strength} related: ${purpose.slice(0, 60)}${purpose.length > 60 ? "..." : ""}`;
  }
  return `${strength} related by semantic similarity`;
}

/**
 * Get file paths for symbol results
 */
async function getSymbolFiles(db: Database, symbols: VectorSearchResult[]): Promise<SuggestResult["symbols"]> {
  const results: SuggestResult["symbols"] = [];

  for (const symbol of symbols) {
    try {
      const fileInfo = db
        .query<{ path: string }, [number]>(
          `SELECT f.path FROM symbols s
           JOIN files f ON s.file_id = f.id
           WHERE s.id = ?`
        )
        .get(symbol.id);

      if (fileInfo) {
        results.push({
          name: symbol.title,
          file: fileInfo.path,
          signature: symbol.content,
          similarity: Math.round(symbol.similarity * 100) / 100,
        });
      }
    } catch {
      // Skip on error
    }
  }

  return results;
}

/**
 * Get blast radius dependents for files
 */
function getBlastDependents(db: Database, projectId: number, files: string[]): SuggestResult["relatedByDeps"] {
  const results: SuggestResult["relatedByDeps"] = [];
  const seen = new Set(files);

  for (const file of files) {
    try {
      const dependents = db
        .query<{ affected_file: string; distance: number }, [number, string]>(
          `SELECT affected_file, distance FROM blast_radius
           WHERE project_id = ? AND source_file = ?
           ORDER BY distance ASC
           LIMIT 3`
        )
        .all(projectId, file);

      for (const d of dependents) {
        if (!seen.has(d.affected_file)) {
          seen.add(d.affected_file);
          results.push({
            path: d.affected_file,
            relatedTo: file,
            relationship: `depends (distance: ${d.distance})`,
          });
        }
      }
    } catch {
      // blast_radius table might not exist
    }
  }

  return results.slice(0, 5);
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleSuggestCommand(db: Database, projectId: number, args: string[]): Promise<void> {
  // Parse arguments
  const includeSymbols = args.includes("--symbols");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 10;

  // Task is everything that's not a flag
  const taskParts = args.filter((a, i) => !a.startsWith("--") && (limitIdx === -1 || i !== limitIdx + 1));
  const task = taskParts.join(" ");

  if (!task) {
    console.error("Usage: muninn suggest <task description> [--symbols] [--limit N]");
    console.error("\nExamples:");
    console.error('  muninn suggest "fix authentication bug"');
    console.error('  muninn suggest "add caching to API" --symbols');
    console.error('  muninn suggest "refactor database queries" --limit 15');
    return;
  }

  const result = await suggestFilesForTask(db, projectId, task, {
    limit,
    includeSymbols,
  });

  // Human-readable output
  console.error(`\n🔍 Semantic Suggestions for: "${task}"\n`);

  if (result.files.length === 0) {
    console.error("  No relevant files found. Try:");
    console.error("  - Running `muninn embed backfill` to generate embeddings");
    console.error("  - Using a more descriptive task");
    console.error("");
    outputJson(result);
    return;
  }

  console.error("  📁 Suggested Files:");
  for (const f of result.files) {
    const sim = `${Math.round(f.similarity * 100)}%`;
    console.error(`     [${sim}] ${f.path}`);
    if (f.purpose) {
      console.error(`            ${f.purpose.slice(0, 60)}`);
    }
  }
  console.error("");

  if (result.symbols.length > 0) {
    console.error("  🔧 Relevant Symbols:");
    for (const s of result.symbols) {
      const sim = `${Math.round(s.similarity * 100)}%`;
      console.error(`     [${sim}] ${s.name} (${s.file})`);
      if (s.signature) {
        console.error(`            ${s.signature.slice(0, 50)}`);
      }
    }
    console.error("");
  }

  if (result.relatedByDeps.length > 0) {
    console.error("  🔗 Also Affected (via dependencies):");
    for (const d of result.relatedByDeps) {
      console.error(`     ${d.path} → ${d.relatedTo}`);
    }
    console.error("");
  }

  // JSON output for MCP
  outputJson(result);
}
