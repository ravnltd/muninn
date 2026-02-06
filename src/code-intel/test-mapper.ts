/**
 * Test-Source Mapper — Link test files to source files
 *
 * Three strategies:
 * 1. Import analysis: parse test imports to find source modules
 * 2. Naming convention: foo.test.ts -> foo.ts
 * 3. Symbol-level: test imports specific function -> map precisely
 *
 * Stored in `test_source_map` table for impact analysis.
 * Runs in background worker — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";

// ============================================================================
// Types
// ============================================================================

export type MatchType = "naming" | "import" | "symbol";

export interface TestMapping {
  testFile: string;
  sourceFile: string;
  sourceSymbol: string | null;
  matchType: MatchType;
  confidence: number;
}

// ============================================================================
// Constants
// ============================================================================

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
];

const PARSEABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__"]);

// ============================================================================
// Test File Detection
// ============================================================================

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(filePath));
}

// ============================================================================
// Strategy 1: Naming Convention
// ============================================================================

/**
 * Match test files to source files by naming convention.
 * foo.test.ts -> foo.ts, components/Bar.spec.tsx -> components/Bar.tsx
 */
function matchByNaming(testFile: string, projectPath: string): TestMapping | null {
  // Strip test/spec suffix: foo.test.ts -> foo.ts
  const sourcePath = testFile
    .replace(/\.test\.([jt]sx?)$/, ".$1")
    .replace(/\.spec\.([jt]sx?)$/, ".$1");

  if (sourcePath === testFile) return null;

  // Check same directory
  if (existsSync(join(projectPath, sourcePath))) {
    return {
      testFile,
      sourceFile: sourcePath,
      sourceSymbol: null,
      matchType: "naming",
      confidence: 0.9,
    };
  }

  // Check src/ equivalent: tests/utils/foo.test.ts -> src/utils/foo.ts
  const srcVariants = [
    sourcePath.replace(/^tests?\//, "src/"),
    sourcePath.replace(/^__tests__\//, "src/"),
    sourcePath.replace(/^test\//, ""),
    sourcePath.replace(/^tests\//, ""),
  ];

  for (const variant of srcVariants) {
    if (variant !== sourcePath && existsSync(join(projectPath, variant))) {
      return {
        testFile,
        sourceFile: variant,
        sourceSymbol: null,
        matchType: "naming",
        confidence: 0.8,
      };
    }
  }

  return null;
}

// ============================================================================
// Strategy 2: Import Analysis
// ============================================================================

/**
 * Parse test file imports to find source modules and specific symbols.
 */
function matchByImports(
  testFile: string,
  content: string,
  projectPath: string
): TestMapping[] {
  const mappings: TestMapping[] = [];
  const dir = dirname(testFile);
  const seen = new Set<string>();

  // Named imports: import { foo, bar } from './module'
  const namedRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = namedRe.exec(content)) !== null) {
    const importPath = match[2];
    if (!importPath.startsWith(".")) continue;

    const resolved = resolveImport(importPath, dir, projectPath);
    if (!resolved || isTestFile(resolved)) continue;

    const key = resolved;
    if (seen.has(key)) continue;
    seen.add(key);

    // Extract individual symbol names
    const symbols = match[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);

    if (symbols.length > 0) {
      // Symbol-level mapping
      for (const sym of symbols) {
        mappings.push({
          testFile,
          sourceFile: resolved,
          sourceSymbol: sym,
          matchType: "symbol",
          confidence: 0.95,
        });
      }
    } else {
      mappings.push({
        testFile,
        sourceFile: resolved,
        sourceSymbol: null,
        matchType: "import",
        confidence: 0.85,
      });
    }
  }

  // Default imports: import Foo from './module'
  const defaultRe = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultRe.exec(content)) !== null) {
    if (match[1] === "type" || match[0].includes("{")) continue;
    const importPath = match[2];
    if (!importPath.startsWith(".")) continue;

    const resolved = resolveImport(importPath, dir, projectPath);
    if (!resolved || isTestFile(resolved)) continue;

    const key = resolved;
    if (seen.has(key)) continue;
    seen.add(key);

    mappings.push({
      testFile,
      sourceFile: resolved,
      sourceSymbol: null,
      matchType: "import",
      confidence: 0.85,
    });
  }

  return mappings;
}

// ============================================================================
// Import Resolution (minimal, shared with call-graph)
// ============================================================================

function resolveImport(importPath: string, fromDir: string, projectPath: string): string | null {
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
// Full Mapping Pipeline
// ============================================================================

/**
 * Map a single test file to its source files using all strategies.
 */
export function mapTestFile(testFile: string, projectPath: string): TestMapping[] {
  const fullPath = join(projectPath, testFile);
  if (!existsSync(fullPath)) return [];

  const mappings: TestMapping[] = [];
  const seen = new Set<string>();

  // Strategy 1: Naming convention
  const namingMatch = matchByNaming(testFile, projectPath);
  if (namingMatch) {
    const key = `${namingMatch.sourceFile}:${namingMatch.sourceSymbol || ""}`;
    seen.add(key);
    mappings.push(namingMatch);
  }

  // Strategy 2 & 3: Import analysis (includes symbol-level)
  try {
    const content = readFileSync(fullPath, "utf-8");
    const importMappings = matchByImports(testFile, content, projectPath);

    for (const m of importMappings) {
      const key = `${m.sourceFile}:${m.sourceSymbol || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        mappings.push(m);
      }
    }
  } catch {
    // Skip unreadable files
  }

  return mappings;
}

/**
 * Discover test files in a project and build the full test-source map.
 */
export function discoverTestFiles(projectPath: string, maxFiles: number = 2000): string[] {
  const testFiles: string[] = [];

  function walk(dir: string, depth: number = 0): void {
    if (depth > 15 || testFiles.length >= maxFiles) return;
    try {
      for (const entry of readdirSync(dir)) {
        if (testFiles.length >= maxFiles) break;
        if (entry.startsWith(".") || IGNORE_DIRS.has(entry)) continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (stat.isFile() && PARSEABLE_EXTENSIONS.has(extname(entry)) && isTestFile(entry)) {
          testFiles.push(relative(projectPath, fullPath));
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  walk(projectPath);
  return testFiles;
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Build test-source map for a project and persist to database.
 */
export async function buildAndPersistTestMap(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  testFiles?: string[]
): Promise<{ tests: number; mappings: number }> {
  const files = testFiles || discoverTestFiles(projectPath);
  let totalMappings = 0;

  for (const testFile of files) {
    const mappings = mapTestFile(testFile, projectPath);

    // Delete existing mappings for this test file
    await db.run(
      `DELETE FROM test_source_map WHERE project_id = ? AND test_file = ?`,
      [projectId, testFile]
    );

    for (const m of mappings) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO test_source_map (project_id, test_file, source_file, source_symbol, match_type, confidence)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [projectId, m.testFile, m.sourceFile, m.sourceSymbol, m.matchType, m.confidence]
        );
        totalMappings++;
      } catch {
        // Skip duplicates
      }
    }
  }

  return { tests: files.length, mappings: totalMappings };
}

/**
 * Look up test files for a given source file.
 */
export async function getTestsForSource(
  db: DatabaseAdapter,
  projectId: number,
  sourceFile: string
): Promise<TestMapping[]> {
  const rows = await db.all<{
    test_file: string;
    source_file: string;
    source_symbol: string | null;
    match_type: string;
    confidence: number;
  }>(
    `SELECT test_file, source_file, source_symbol, match_type, confidence
     FROM test_source_map
     WHERE project_id = ? AND source_file = ?
     ORDER BY confidence DESC`,
    [projectId, sourceFile]
  );

  return rows.map((r) => ({
    testFile: r.test_file,
    sourceFile: r.source_file,
    sourceSymbol: r.source_symbol,
    matchType: r.match_type as MatchType,
    confidence: r.confidence,
  }));
}

/**
 * Look up source files for a given test file.
 */
export async function getSourcesForTest(
  db: DatabaseAdapter,
  projectId: number,
  testFile: string
): Promise<TestMapping[]> {
  const rows = await db.all<{
    test_file: string;
    source_file: string;
    source_symbol: string | null;
    match_type: string;
    confidence: number;
  }>(
    `SELECT test_file, source_file, source_symbol, match_type, confidence
     FROM test_source_map
     WHERE project_id = ? AND test_file = ?
     ORDER BY confidence DESC`,
    [projectId, testFile]
  );

  return rows.map((r) => ({
    testFile: r.test_file,
    sourceFile: r.source_file,
    sourceSymbol: r.source_symbol,
    matchType: r.match_type as MatchType,
    confidence: r.confidence,
  }));
}
