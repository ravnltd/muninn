/**
 * Chunk Commands
 *
 * Extract and store semantic code chunks from source files.
 * Enables fine-grained search at function/class level.
 */

import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { parseFile, chunkToSearchText, type CodeChunk, type ChunkResult } from "../analysis/chunker";
import { embed, embedBatch, isAvailable as isEmbeddingAvailable } from "../embeddings/voyage";
import { outputJson } from "../utils/format";
import { logError } from "../utils/errors";

// ============================================================================
// Types
// ============================================================================

interface ChunkStats {
  filesProcessed: number;
  chunksExtracted: number;
  chunksStored: number;
  embeddingsGenerated: number;
  errors: string[];
}

interface StoredSymbol {
  id: number;
  file_id: number;
  name: string;
  type: string;
  signature: string;
  purpose: string | null;
  start_line: number;
  end_line: number;
}

// ============================================================================
// File Discovery
// ============================================================================

const IGNORED_DIRS = [
  'node_modules', '.git', 'dist', 'build', '.next', '.svelte-kit',
  'coverage', '.turbo', '.vercel', '__pycache__', 'vendor', 'target'
];

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.go', '.svelte', '.vue'];

/**
 * Find all code files in a directory
 */
function findCodeFiles(dir: string, maxFiles: number = 500): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    if (files.length >= maxFiles) return;

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) return;

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = '.' + entry.name.split('.').pop()?.toLowerCase();
          if (CODE_EXTENSIONS.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walk(dir);
  return files;
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Get or create file record
 */
function getFileId(db: Database, projectId: number, filePath: string): number | null {
  const existing = db.query<{ id: number }, [number, string]>(
    `SELECT id FROM files WHERE project_id = ? AND path = ?`
  ).get(projectId, filePath);

  if (existing) return existing.id;

  // Create minimal file record
  try {
    const result = db.run(
      `INSERT INTO files (project_id, path, type, status) VALUES (?, ?, 'source', 'active')`,
      [projectId, filePath]
    );
    return Number(result.lastInsertRowid);
  } catch {
    return null;
  }
}

/**
 * Clear existing symbols for a file
 */
function clearFileSymbols(db: Database, fileId: number): void {
  // Delete from FTS first (must happen before symbols are deleted)
  db.run(`DELETE FROM fts_symbols WHERE rowid IN (SELECT id FROM symbols WHERE file_id = ?)`, [fileId]);
  // Then delete from symbols
  db.run(`DELETE FROM symbols WHERE file_id = ?`, [fileId]);
}

/**
 * Store a code chunk as a symbol
 */
function storeChunk(
  db: Database,
  fileId: number,
  chunk: CodeChunk,
  embedding: number[] | null
): number | null {
  try {
    const embeddingBlob = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;

    const result = db.run(
      `INSERT INTO symbols (
        file_id, name, type, signature, purpose, parameters, returns,
        complexity, embedding, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        fileId,
        chunk.name,
        chunk.type,
        chunk.signature,
        chunk.purpose || null,
        chunk.parameters ? JSON.stringify(chunk.parameters) : null,
        chunk.returnType || null,
        Math.min(10, Math.floor((chunk.endLine - chunk.startLine) / 10)), // Simple complexity
        embeddingBlob
      ]
    );

    const symbolId = Number(result.lastInsertRowid);
    // FTS is auto-populated by trigger in schema.sql (symbols_ai)
    return symbolId;
  } catch (error) {
    logError('storeChunk', error);
    return null;
  }
}

// ============================================================================
// Chunking Operations
// ============================================================================

/**
 * Chunk a single file and store symbols
 */
async function chunkFile(
  db: Database,
  projectId: number,
  projectPath: string,
  filePath: string,
  generateEmbeddings: boolean
): Promise<{ chunks: number; errors: string[] }> {
  const relativePath = relative(projectPath, filePath);
  const result = parseFile(filePath);

  if (!result) {
    return { chunks: 0, errors: [`Unsupported file type: ${relativePath}`] };
  }

  if (result.chunks.length === 0) {
    return { chunks: 0, errors: result.errors };
  }

  // Get file ID
  const fileId = getFileId(db, projectId, relativePath);
  if (!fileId) {
    return { chunks: 0, errors: [`Failed to get file ID for ${relativePath}`] };
  }

  // Clear existing symbols
  clearFileSymbols(db, fileId);

  // Generate embeddings in batch if available
  let embeddings: (number[] | null)[] = [];

  if (generateEmbeddings && isEmbeddingAvailable()) {
    const searchTexts = result.chunks.map(chunkToSearchText);
    const batchResult = await embedBatch(searchTexts);

    if (batchResult) {
      embeddings = batchResult;
    } else {
      embeddings = result.chunks.map(() => null);
    }
  } else {
    embeddings = result.chunks.map(() => null);
  }

  // Store chunks
  let stored = 0;
  for (let i = 0; i < result.chunks.length; i++) {
    const chunk = result.chunks[i];
    const embedding = embeddings[i] || null;

    if (storeChunk(db, fileId, chunk, embedding)) {
      stored++;
    }
  }

  return { chunks: stored, errors: result.errors };
}

/**
 * Chunk all files in a project
 */
export async function chunkProject(
  db: Database,
  projectId: number,
  projectPath: string,
  options: {
    embeddings?: boolean;
    maxFiles?: number;
    verbose?: boolean;
  } = {}
): Promise<ChunkStats> {
  const { embeddings = true, maxFiles = 500, verbose = false } = options;

  const stats: ChunkStats = {
    filesProcessed: 0,
    chunksExtracted: 0,
    chunksStored: 0,
    embeddingsGenerated: 0,
    errors: []
  };

  const files = findCodeFiles(projectPath, maxFiles);

  if (verbose) {
    console.error(`\n🔍 Found ${files.length} code files to analyze\n`);
  }

  for (const file of files) {
    const relativePath = relative(projectPath, file);

    if (verbose) {
      process.stderr.write(`  Chunking ${relativePath}...`);
    }

    const result = await chunkFile(db, projectId, projectPath, file, embeddings);
    stats.filesProcessed++;
    stats.chunksStored += result.chunks;

    if (result.chunks > 0 && embeddings && isEmbeddingAvailable()) {
      stats.embeddingsGenerated += result.chunks;
    }

    if (result.errors.length > 0) {
      stats.errors.push(...result.errors);
    }

    if (verbose) {
      if (result.chunks > 0) {
        console.error(` ${result.chunks} chunks`);
      } else {
        console.error(` (no chunks)`);
      }
    }
  }

  return stats;
}

/**
 * Get symbol statistics for a project
 */
export function getSymbolStats(db: Database, projectId: number): {
  totalSymbols: number;
  byType: Record<string, number>;
  withEmbeddings: number;
  topFiles: Array<{ path: string; count: number }>;
} {
  const total = db.query<{ count: number }, [number]>(
    `SELECT COUNT(*) as count FROM symbols s
     JOIN files f ON s.file_id = f.id
     WHERE f.project_id = ?`
  ).get(projectId)?.count || 0;

  const byType = db.query<{ type: string; count: number }, [number]>(
    `SELECT s.type, COUNT(*) as count FROM symbols s
     JOIN files f ON s.file_id = f.id
     WHERE f.project_id = ?
     GROUP BY s.type`
  ).all(projectId);

  const withEmbeddings = db.query<{ count: number }, [number]>(
    `SELECT COUNT(*) as count FROM symbols s
     JOIN files f ON s.file_id = f.id
     WHERE f.project_id = ? AND s.embedding IS NOT NULL`
  ).get(projectId)?.count || 0;

  const topFiles = db.query<{ path: string; count: number }, [number]>(
    `SELECT f.path, COUNT(*) as count FROM symbols s
     JOIN files f ON s.file_id = f.id
     WHERE f.project_id = ?
     GROUP BY f.id
     ORDER BY count DESC
     LIMIT 10`
  ).all(projectId);

  return {
    totalSymbols: total,
    byType: Object.fromEntries(byType.map(r => [r.type, r.count])),
    withEmbeddings,
    topFiles
  };
}

/**
 * Search symbols by name or purpose
 */
export function searchSymbols(
  db: Database,
  projectId: number,
  query: string,
  limit: number = 20
): Array<{
  id: number;
  name: string;
  type: string;
  signature: string;
  purpose: string | null;
  file: string;
}> {
  // Use FTS for search
  return db.query<{
    id: number;
    name: string;
    type: string;
    signature: string;
    purpose: string | null;
    file: string;
  }, [string, number, number]>(
    `SELECT s.id, s.name, s.type, s.signature, s.purpose, f.path as file
     FROM fts_symbols fts
     JOIN symbols s ON fts.rowid = s.id
     JOIN files f ON s.file_id = f.id
     WHERE f.project_id = ? AND fts_symbols MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).all(projectId, query, limit);
}

// ============================================================================
// Command Handler
// ============================================================================

export async function handleChunkCommand(
  db: Database,
  projectId: number,
  projectPath: string,
  args: string[]
): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case 'run':
    case undefined: {
      const noEmbeddings = args.includes('--no-embeddings');
      const verbose = args.includes('-v') || args.includes('--verbose');
      const maxFilesIdx = args.indexOf('--max');
      const maxFiles = maxFilesIdx !== -1 ? parseInt(args[maxFilesIdx + 1]) : 500;

      console.error('🧩 Chunking codebase...\n');

      const stats = await chunkProject(db, projectId, projectPath, {
        embeddings: !noEmbeddings,
        maxFiles,
        verbose
      });

      console.error(`\n✅ Chunking complete:`);
      console.error(`   Files processed: ${stats.filesProcessed}`);
      console.error(`   Symbols extracted: ${stats.chunksStored}`);
      if (!noEmbeddings) {
        console.error(`   Embeddings generated: ${stats.embeddingsGenerated}`);
      }

      if (stats.errors.length > 0) {
        console.error(`\n⚠️  ${stats.errors.length} warning(s):`);
        for (const err of stats.errors.slice(0, 5)) {
          console.error(`   - ${err}`);
        }
        if (stats.errors.length > 5) {
          console.error(`   ... and ${stats.errors.length - 5} more`);
        }
      }

      outputJson(stats);
      break;
    }

    case 'status':
    case 'stats': {
      const stats = getSymbolStats(db, projectId);

      console.error('\n📊 Symbol Statistics:\n');
      console.error(`   Total symbols: ${stats.totalSymbols}`);
      console.error(`   With embeddings: ${stats.withEmbeddings}`);
      console.error('\n   By type:');
      for (const [type, count] of Object.entries(stats.byType)) {
        console.error(`     ${type}: ${count}`);
      }

      if (stats.topFiles.length > 0) {
        console.error('\n   Top files:');
        for (const f of stats.topFiles.slice(0, 5)) {
          console.error(`     ${f.path}: ${f.count} symbols`);
        }
      }

      outputJson(stats);
      break;
    }

    case 'search':
    case 'find': {
      const query = args.slice(1).filter(a => !a.startsWith('-')).join(' ');
      if (!query) {
        console.error('Usage: context chunk search <query>');
        process.exit(1);
      }

      const results = searchSymbols(db, projectId, query);

      if (results.length === 0) {
        console.error(`No symbols found matching "${query}"`);
      } else {
        console.error(`\n🔍 Found ${results.length} symbol(s):\n`);
        for (const r of results) {
          console.error(`   [${r.type}] ${r.name}`);
          console.error(`     File: ${r.file}`);
          if (r.purpose) {
            console.error(`     Purpose: ${r.purpose}`);
          }
          console.error('');
        }
      }

      outputJson(results);
      break;
    }

    case 'file': {
      const filePath = args[1];
      if (!filePath) {
        console.error('Usage: context chunk file <path>');
        process.exit(1);
      }

      const fullPath = join(projectPath, filePath);
      if (!existsSync(fullPath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
      }

      const result = parseFile(fullPath);
      if (!result) {
        console.error('Unsupported file type');
        process.exit(1);
      }

      console.error(`\n📄 ${filePath} (${result.language})\n`);
      console.error(`   Found ${result.chunks.length} chunk(s):\n`);

      for (const chunk of result.chunks) {
        const exportIcon = chunk.exported ? '📤' : '  ';
        console.error(`   ${exportIcon} [${chunk.type}] ${chunk.name}`);
        console.error(`      Lines ${chunk.startLine}-${chunk.endLine}`);
        if (chunk.purpose) {
          console.error(`      ${chunk.purpose}`);
        }
      }

      outputJson(result);
      break;
    }

    default:
      console.error('Usage: context chunk <command>');
      console.error('');
      console.error('Commands:');
      console.error('  run [--no-embeddings] [-v]   Chunk all code files');
      console.error('  status                       Show symbol statistics');
      console.error('  search <query>               Search symbols');
      console.error('  file <path>                  Preview chunks for a file');
      process.exit(1);
  }
}
