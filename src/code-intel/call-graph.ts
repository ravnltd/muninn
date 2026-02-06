/**
 * Call Graph Builder — Function-to-function call relationships
 *
 * Extracts call edges from source code using regex + import resolution.
 * Cross-file calls resolved by matching imported symbols to their definitions.
 * Stored in `call_graph` table for impact analysis.
 *
 * Runs in background worker — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { ExtractedSymbol } from "./ast-parser";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";

// ============================================================================
// Types
// ============================================================================

export type CallType = "direct" | "method" | "callback" | "dynamic";

export interface CallEdge {
  callerFile: string;
  callerSymbol: string;
  calleeFile: string;
  calleeSymbol: string;
  callType: CallType;
  confidence: number;
}

interface ImportBinding {
  localName: string;
  importedName: string;
  sourceFile: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_FILE_SIZE = 50 * 1024;
const PARSEABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// ============================================================================
// Import Resolution
// ============================================================================

/** Extract import bindings from a file's source code */
function extractImports(content: string, filePath: string, projectPath: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const dir = dirname(filePath);

  // Named imports: import { foo, bar as baz } from './module'
  const namedRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = namedRe.exec(content)) !== null) {
    const resolved = resolveImport(match[2], dir, projectPath);
    if (!resolved) continue;

    for (const spec of match[1].split(",")) {
      const trimmed = spec.trim();
      if (!trimmed) continue;
      const asParts = trimmed.split(/\s+as\s+/);
      bindings.push({
        importedName: asParts[0].trim(),
        localName: (asParts[1] || asParts[0]).trim(),
        sourceFile: resolved,
      });
    }
  }

  // Default imports: import Foo from './module'
  const defaultRe = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultRe.exec(content)) !== null) {
    // Skip if this looks like a named/namespace import
    if (match[1] === "type" || match[0].includes("{")) continue;
    const resolved = resolveImport(match[2], dir, projectPath);
    if (!resolved) continue;
    bindings.push({
      importedName: "default",
      localName: match[1],
      sourceFile: resolved,
    });
  }

  // Namespace imports: import * as foo from './module'
  const nsRe = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = nsRe.exec(content)) !== null) {
    const resolved = resolveImport(match[2], dir, projectPath);
    if (!resolved) continue;
    bindings.push({
      importedName: "*",
      localName: match[1],
      sourceFile: resolved,
    });
  }

  return bindings;
}

/** Resolve a relative import to a project-relative file path */
function resolveImport(importPath: string, fromDir: string, projectPath: string): string | null {
  // Only resolve relative imports
  if (!importPath.startsWith(".")) return null;

  const basePath = join(fromDir, importPath);
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

  for (const ext of extensions) {
    const fullPath = join(projectPath, basePath + ext);
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      return relative(projectPath, fullPath);
    }
  }

  return null;
}

// ============================================================================
// Call Extraction
// ============================================================================

/**
 * Extract call edges from a file, given its symbols and import bindings.
 * Matches function/method calls against known imports and local symbols.
 */
export function extractCallEdges(
  content: string,
  filePath: string,
  fileSymbols: ExtractedSymbol[],
  imports: ImportBinding[]
): CallEdge[] {
  const edges: CallEdge[] = [];
  const lines = content.split("\n");

  // Build lookup: imported local name -> source binding
  const importMap = new Map<string, ImportBinding>();
  for (const binding of imports) {
    importMap.set(binding.localName, binding);
  }

  // For each function/method in this file, scan its body for calls
  const callableSymbols = fileSymbols.filter(
    (s) => s.kind === "function" || s.kind === "method"
  );

  for (const sym of callableSymbols) {
    const bodyStart = sym.lineStart - 1;
    const bodyEnd = Math.min(sym.lineEnd, lines.length);
    const body = lines.slice(bodyStart, bodyEnd).join("\n");

    // Match function calls: identifier(
    const callRe = /\b(\w+)\s*\(/g;
    let callMatch: RegExpExecArray | null;
    const seen = new Set<string>();

    while ((callMatch = callRe.exec(body)) !== null) {
      const calledName = callMatch[1];
      if (seen.has(calledName)) continue;
      seen.add(calledName);

      // Skip language keywords
      if (isKeyword(calledName)) continue;

      // Check if this is an imported symbol
      const binding = importMap.get(calledName);
      if (binding) {
        edges.push({
          callerFile: filePath,
          callerSymbol: sym.parentClass ? `${sym.parentClass}.${sym.name}` : sym.name,
          calleeFile: binding.sourceFile,
          calleeSymbol: binding.importedName === "default" ? calledName : binding.importedName,
          callType: "direct",
          confidence: 0.85,
        });
        continue;
      }

      // Check if calling a local symbol
      const localTarget = fileSymbols.find(
        (s) => s.name === calledName && s !== sym && (s.kind === "function" || s.kind === "method")
      );
      if (localTarget) {
        edges.push({
          callerFile: filePath,
          callerSymbol: sym.parentClass ? `${sym.parentClass}.${sym.name}` : sym.name,
          calleeFile: filePath,
          calleeSymbol: localTarget.parentClass
            ? `${localTarget.parentClass}.${localTarget.name}`
            : localTarget.name,
          callType: "direct",
          confidence: 0.9,
        });
      }
    }

    // Match method calls on imported objects: importedObj.method(
    const methodRe = /\b(\w+)\.(\w+)\s*\(/g;
    let methodMatch: RegExpExecArray | null;

    while ((methodMatch = methodRe.exec(body)) !== null) {
      const objName = methodMatch[1];
      const methodName = methodMatch[2];
      const key = `${objName}.${methodName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const binding = importMap.get(objName);
      if (binding && binding.importedName === "*") {
        // Namespace call: ns.func()
        edges.push({
          callerFile: filePath,
          callerSymbol: sym.parentClass ? `${sym.parentClass}.${sym.name}` : sym.name,
          calleeFile: binding.sourceFile,
          calleeSymbol: methodName,
          callType: "method",
          confidence: 0.75,
        });
      }
    }
  }

  return edges;
}

// ============================================================================
// Keywords
// ============================================================================

const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "new", "super",
  "this", "typeof", "void", "delete", "throw", "await", "yield",
  "import", "export", "require", "console", "Math", "JSON", "Array",
  "Object", "String", "Number", "Boolean", "Date", "Promise", "Set",
  "Map", "Error", "RegExp", "parseInt", "parseFloat", "setTimeout",
  "setInterval", "clearTimeout", "clearInterval",
]);

function isKeyword(name: string): boolean {
  return KEYWORDS.has(name);
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Build call graph for a set of files and persist to database.
 * Requires symbols to already be in the DB (run AST parser first).
 */
export async function buildAndPersistCallGraph(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  filePaths: string[]
): Promise<{ files: number; edges: number }> {
  let totalEdges = 0;

  for (const filePath of filePaths) {
    const ext = extname(filePath);
    if (!PARSEABLE_EXTENSIONS.has(ext)) continue;

    const fullPath = join(projectPath, filePath);
    if (!existsSync(fullPath)) continue;

    const stat = statSync(fullPath);
    if (stat.size > MAX_FILE_SIZE) continue;

    try {
      const content = readFileSync(fullPath, "utf-8");

      // Extract symbols with line info for body scanning
      const { extractSymbols } = await import("./ast-parser");
      const liveSymbols = extractSymbols(content, filePath);

      const imports = extractImports(content, filePath, projectPath);
      const edges = extractCallEdges(content, filePath, liveSymbols, imports);

      // Delete existing edges from this caller file
      await db.run(
        `DELETE FROM call_graph WHERE project_id = ? AND caller_file = ?`,
        [projectId, filePath]
      );

      // Insert new edges
      for (const edge of edges) {
        await db.run(
          `INSERT INTO call_graph (project_id, caller_file, caller_symbol, callee_file, callee_symbol, call_type, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [projectId, edge.callerFile, edge.callerSymbol, edge.calleeFile, edge.calleeSymbol, edge.callType, edge.confidence]
        );
        totalEdges++;
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  return { files: filePaths.length, edges: totalEdges };
}

/**
 * Get all callers of a given symbol (reverse lookup).
 */
export async function getCallers(
  db: DatabaseAdapter,
  projectId: number,
  file: string,
  symbol: string
): Promise<CallEdge[]> {
  const rows = await db.all<{
    caller_file: string;
    caller_symbol: string;
    callee_file: string;
    callee_symbol: string;
    call_type: string;
    confidence: number;
  }>(
    `SELECT caller_file, caller_symbol, callee_file, callee_symbol, call_type, confidence
     FROM call_graph
     WHERE project_id = ? AND callee_file = ? AND callee_symbol = ?
     ORDER BY confidence DESC`,
    [projectId, file, symbol]
  );

  return rows.map((r) => ({
    callerFile: r.caller_file,
    callerSymbol: r.caller_symbol,
    calleeFile: r.callee_file,
    calleeSymbol: r.callee_symbol,
    callType: r.call_type as CallType,
    confidence: r.confidence,
  }));
}

/**
 * Get all callees from a given symbol (forward lookup).
 */
export async function getCallees(
  db: DatabaseAdapter,
  projectId: number,
  file: string,
  symbol: string
): Promise<CallEdge[]> {
  const rows = await db.all<{
    caller_file: string;
    caller_symbol: string;
    callee_file: string;
    callee_symbol: string;
    call_type: string;
    confidence: number;
  }>(
    `SELECT caller_file, caller_symbol, callee_file, callee_symbol, call_type, confidence
     FROM call_graph
     WHERE project_id = ? AND caller_file = ? AND caller_symbol = ?
     ORDER BY confidence DESC`,
    [projectId, file, symbol]
  );

  return rows.map((r) => ({
    callerFile: r.caller_file,
    callerSymbol: r.caller_symbol,
    calleeFile: r.callee_file,
    calleeSymbol: r.callee_symbol,
    callType: r.call_type as CallType,
    confidence: r.confidence,
  }));
}
