/**
 * AST Parser — TypeScript Compiler API for Deep Analysis
 *
 * Extracts functions, classes, interfaces, and constants with line ranges.
 * Populates the `symbols` table incrementally (only re-parses changed files).
 * Runs in background worker — never blocks MCP tool calls.
 *
 * Skip files > 50KB. Process in batches of 10.
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// ============================================================================
// Types
// ============================================================================

export type SymbolKind = "function" | "class" | "interface" | "type" | "constant" | "enum" | "method";

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  signature: string;
  lineStart: number;
  lineEnd: number;
  isExported: boolean;
  parameters?: string;
  returnType?: string;
  parentClass?: string;
}

interface ParsedFile {
  path: string;
  symbols: ExtractedSymbol[];
  contentHash: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_FILE_SIZE = 50 * 1024; // 50KB
const BATCH_SIZE = 10;
const PARSEABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// ============================================================================
// Content Hashing
// ============================================================================

function hashContent(content: string): string {
  // Simple FNV-1a 32-bit hash — fast, no crypto overhead
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ============================================================================
// Regex-Based Symbol Extraction
// ============================================================================

/**
 * Extract symbols from TypeScript/JavaScript source code.
 * Uses regex patterns for speed — no TS Compiler API dependency.
 * Trades some accuracy for zero startup cost and fast batch processing.
 */
export function extractSymbols(content: string, filePath: string): ExtractedSymbol[] {
  const ext = extname(filePath);
  if (!PARSEABLE_EXTENSIONS.has(ext)) return [];

  const symbols: ExtractedSymbol[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track if the declaration is exported
    const isExported = /^\s*export\s/.test(line);
    const cleanLine = line.replace(/^\s*export\s+(default\s+)?/, "");

    // --- Functions ---
    const funcMatch = cleanLine.match(
      /^(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/
    );
    if (funcMatch) {
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name: funcMatch[1],
        kind: "function",
        signature: `function ${funcMatch[1]}(${funcMatch[2].trim()})${funcMatch[3] ? `: ${funcMatch[3]}` : ""}`,
        lineStart: lineNum,
        lineEnd: endLine,
        isExported,
        parameters: funcMatch[2].trim() || undefined,
        returnType: funcMatch[3]?.trim() || undefined,
      });
      continue;
    }

    // --- Arrow functions assigned to const/let ---
    const arrowMatch = cleanLine.match(
      /^(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]*)?\s*=>/
    );
    if (arrowMatch) {
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name: arrowMatch[1],
        kind: "function",
        signature: `const ${arrowMatch[1]} = (...)`,
        lineStart: lineNum,
        lineEnd: endLine,
        isExported,
      });
      continue;
    }

    // --- Classes ---
    const classMatch = cleanLine.match(
      /^(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/
    );
    if (classMatch) {
      const endLine = findBlockEnd(lines, i);
      const sig = `class ${classMatch[1]}${classMatch[2] ? ` extends ${classMatch[2]}` : ""}`;
      symbols.push({
        name: classMatch[1],
        kind: "class",
        signature: sig,
        lineStart: lineNum,
        lineEnd: endLine,
        isExported,
      });

      // Extract methods within the class
      extractClassMembers(lines, i, endLine, classMatch[1], symbols);
      continue;
    }

    // --- Interfaces ---
    const ifaceMatch = cleanLine.match(/^interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([^{]+))?/);
    if (ifaceMatch) {
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name: ifaceMatch[1],
        kind: "interface",
        signature: `interface ${ifaceMatch[1]}${ifaceMatch[2] ? ` extends ${ifaceMatch[2].trim()}` : ""}`,
        lineStart: lineNum,
        lineEnd: endLine,
        isExported,
      });
      continue;
    }

    // --- Type aliases ---
    const typeMatch = cleanLine.match(/^type\s+(\w+)(?:<[^>]*>)?\s*=/);
    if (typeMatch) {
      const endLine = findStatementEnd(lines, i);
      symbols.push({
        name: typeMatch[1],
        kind: "type",
        signature: `type ${typeMatch[1]}`,
        lineStart: lineNum,
        lineEnd: endLine,
        isExported,
      });
      continue;
    }

    // --- Enums ---
    const enumMatch = cleanLine.match(/^(?:const\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name: enumMatch[1],
        kind: "enum",
        signature: `enum ${enumMatch[1]}`,
        lineStart: lineNum,
        lineEnd: endLine,
        isExported,
      });
      continue;
    }

    // --- Constants (non-arrow-function) ---
    const constMatch = cleanLine.match(/^const\s+(\w+)\s*(?::\s*([^=]+))?\s*=\s*(?!.*=>)/);
    if (constMatch && !cleanLine.includes("=>")) {
      symbols.push({
        name: constMatch[1],
        kind: "constant",
        signature: `const ${constMatch[1]}${constMatch[2] ? `: ${constMatch[2].trim()}` : ""}`,
        lineStart: lineNum,
        lineEnd: lineNum,
        isExported,
      });
    }
  }

  return symbols;
}

/** Extract class methods from within a class body */
function extractClassMembers(
  lines: string[],
  classStart: number,
  classEnd: number,
  className: string,
  symbols: ExtractedSymbol[]
): void {
  for (let i = classStart + 1; i < classEnd && i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Method patterns
    const methodMatch = line.match(
      /^\s+(?:(?:public|private|protected|static|async|abstract|readonly|override)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/
    );
    if (methodMatch && !["if", "for", "while", "switch", "catch", "return", "new", "super", "this"].includes(methodMatch[1])) {
      const endLine = findBlockEnd(lines, i);
      symbols.push({
        name: methodMatch[1],
        kind: "method",
        signature: `${className}.${methodMatch[1]}(${methodMatch[2].trim()})`,
        lineStart: lineNum,
        lineEnd: endLine,
        isExported: false,
        parameters: methodMatch[2].trim() || undefined,
        returnType: methodMatch[3]?.trim() || undefined,
        parentClass: className,
      });
    }
  }
}

/** Find the end of a block (matching closing brace) */
function findBlockEnd(lines: string[], startLine: number): number {
  let braceCount = 0;
  let foundOpen = false;

  for (let i = startLine; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === "{") { braceCount++; foundOpen = true; }
      if (char === "}") braceCount--;
      if (foundOpen && braceCount === 0) return i + 1;
    }
  }

  return startLine + 1;
}

/** Find the end of a statement (semicolon or next non-continuation line) */
function findStatementEnd(lines: string[], startLine: number): number {
  for (let i = startLine; i < Math.min(startLine + 20, lines.length); i++) {
    if (lines[i].includes(";") || (i > startLine && !lines[i].match(/^\s*[|&]/))) {
      return i + 1;
    }
  }
  return startLine + 1;
}

// ============================================================================
// Incremental Parsing
// ============================================================================

/**
 * Parse a single file and return extracted symbols.
 * Checks content hash to skip unchanged files.
 */
export function parseFile(filePath: string, projectPath: string): ParsedFile | null {
  const fullPath = join(projectPath, filePath);

  if (!existsSync(fullPath)) return null;

  const stat = statSync(fullPath);
  if (stat.size > MAX_FILE_SIZE) return null;

  const ext = extname(filePath);
  if (!PARSEABLE_EXTENSIONS.has(ext)) return null;

  try {
    const content = readFileSync(fullPath, "utf-8");
    const contentHash = hashContent(content);
    const symbols = extractSymbols(content, filePath);

    return { path: filePath, symbols, contentHash };
  } catch {
    return null;
  }
}

/**
 * Parse files and persist symbols to the database.
 * Incremental: skips files whose content_hash hasn't changed.
 */
export async function parseAndPersist(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  filePaths: string[]
): Promise<{ parsed: number; skipped: number; symbols: number }> {
  let parsed = 0;
  let skipped = 0;
  let totalSymbols = 0;

  // Process in batches
  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE);

    for (const filePath of batch) {
      // Check if file needs re-parsing
      const existing = await db.get<{ content_hash: string | null }>(
        `SELECT content_hash FROM files WHERE project_id = ? AND path = ?`,
        [projectId, filePath]
      );

      const result = parseFile(filePath, projectPath);
      if (!result) { skipped++; continue; }

      // Skip if hash unchanged
      if (existing?.content_hash === result.contentHash) {
        skipped++;
        continue;
      }

      // Ensure file record exists
      await db.run(
        `INSERT INTO files (project_id, path, purpose, fragility, content_hash)
         VALUES (?, ?, 'Auto-tracked', 3, ?)
         ON CONFLICT(project_id, path) DO UPDATE SET content_hash = excluded.content_hash, updated_at = datetime('now')`,
        [projectId, filePath, result.contentHash]
      );

      // Get file ID
      const fileRecord = await db.get<{ id: number }>(
        `SELECT id FROM files WHERE project_id = ? AND path = ?`,
        [projectId, filePath]
      );
      if (!fileRecord) continue;

      // Delete existing symbols for this file
      await db.run(`DELETE FROM symbols WHERE file_id = ?`, [fileRecord.id]);

      // Insert new symbols
      for (const sym of result.symbols) {
        await db.run(
          `INSERT INTO symbols (file_id, name, type, signature, purpose, parameters, returns)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            fileRecord.id,
            sym.name,
            sym.kind,
            sym.signature,
            sym.parentClass ? `Method of ${sym.parentClass}` : null,
            sym.parameters || null,
            sym.returnType || null,
          ]
        );
        totalSymbols++;
      }

      parsed++;
    }
  }

  return { parsed, skipped, symbols: totalSymbols };
}

/**
 * Reindex all parseable files in the project.
 * Called by `muninn reindex` CLI command.
 */
export async function reindexProject(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string
): Promise<{ parsed: number; skipped: number; symbols: number }> {
  const { readdirSync, statSync: statSyncFn } = await import("node:fs");
  const { relative: relativeFn } = await import("node:path");

  const files: string[] = [];
  const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__"]);

  function walk(dir: string, depth: number = 0): void {
    if (depth > 15 || files.length >= 2000) return;
    try {
      for (const entry of readdirSync(dir)) {
        if (files.length >= 2000) break;
        if (entry.startsWith(".") || ignoreDirs.has(entry)) continue;
        const fullPath = join(dir, entry);
        const stat = statSyncFn(fullPath);
        if (stat.isDirectory()) walk(fullPath, depth + 1);
        else if (stat.isFile() && PARSEABLE_EXTENSIONS.has(extname(entry))) {
          files.push(relativeFn(projectPath, fullPath));
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  walk(projectPath);

  return parseAndPersist(db, projectId, projectPath, files);
}
