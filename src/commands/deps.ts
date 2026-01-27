/**
 * Dependency tracking commands
 * Import graph building, dependency analysis
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { logError, safeJsonParse } from "../utils/errors";
import { outputJson } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

interface DependencyInfo {
  path: string;
  imports: string[];
  dependents: string[];
  externalDeps: string[];
}

interface DependencyGraph {
  files: Map<string, DependencyInfo>;
  errors: string[];
}

// ============================================================================
// Import Parsing
// ============================================================================

const JS_IMPORT_PATTERNS = [
  // ES6 imports
  /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g,
  // Dynamic imports
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // require
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // export from
  /export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/g,
];

const PYTHON_IMPORT_PATTERNS = [
  // from X import Y (relative and absolute)
  /^from\s+(\.+[\w.]*|[\w.]+)\s+import\s+/gm,
  // import X (absolute)
  /^import\s+([\w.]+)(?:\s+as\s+\w+)?$/gm,
];

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".py"]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".svelte-kit",
  "__pycache__",
  ".pytest_cache",
  "target",
  "vendor",
  ".claude",
  ".vscode",
  ".idea",
  "coverage",
]);

function parseImports(
  content: string,
  filePath: string,
  projectPath: string
): {
  localImports: string[];
  externalDeps: string[];
} {
  const isPython = filePath.endsWith(".py");

  if (isPython) {
    return parsePythonImports(content, filePath, projectPath);
  }

  return parseJsImports(content, filePath, projectPath);
}

function parseJsImports(
  content: string,
  filePath: string,
  projectPath: string
): {
  localImports: string[];
  externalDeps: string[];
} {
  const localImports: string[] = [];
  const externalDeps: string[] = [];
  const seen = new Set<string>();

  for (const pattern of JS_IMPORT_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1];
      if (seen.has(importPath)) continue;
      seen.add(importPath);

      if (importPath.startsWith(".")) {
        // Relative import - resolve to actual file
        const resolved = resolveRelativeImport(filePath, importPath, projectPath);
        if (resolved) {
          localImports.push(resolved);
        }
      } else if (importPath.startsWith("@/") || importPath.startsWith("~/")) {
        // Alias import - try to resolve
        const aliasPath = importPath.replace(/^[@~]\//, "src/");
        const resolved = resolveAliasImport(aliasPath, projectPath);
        if (resolved) {
          localImports.push(resolved);
        }
      } else if (!importPath.startsWith("node:") && !importPath.includes(":")) {
        // External package
        const pkgName = importPath.startsWith("@")
          ? importPath.split("/").slice(0, 2).join("/")
          : importPath.split("/")[0];
        if (!externalDeps.includes(pkgName)) {
          externalDeps.push(pkgName);
        }
      }
    }
  }

  return { localImports, externalDeps };
}

function parsePythonImports(
  content: string,
  filePath: string,
  projectPath: string
): {
  localImports: string[];
  externalDeps: string[];
} {
  const localImports: string[] = [];
  const externalDeps: string[] = [];
  const seen = new Set<string>();

  for (const pattern of PYTHON_IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(content)) !== null) {
      const modulePath = match[1];
      if (seen.has(modulePath)) continue;
      seen.add(modulePath);

      if (modulePath.startsWith(".")) {
        // Relative import — resolve dots to directory traversal
        const resolved = resolvePythonRelativeImport(filePath, modulePath, projectPath);
        if (resolved) {
          localImports.push(resolved);
        }
      } else {
        // Could be local or external — try to resolve as local first
        const resolved = resolvePythonAbsoluteImport(modulePath, filePath, projectPath);
        if (resolved) {
          localImports.push(resolved);
        } else {
          // Top-level package name as external dep
          const pkgName = modulePath.split(".")[0];
          if (!externalDeps.includes(pkgName)) {
            externalDeps.push(pkgName);
          }
        }
      }
    }
  }

  return { localImports, externalDeps };
}

function resolvePythonRelativeImport(fromFile: string, modulePath: string, projectPath: string): string | null {
  const fromDir = dirname(fromFile);

  // Count leading dots for directory traversal
  const dots = modulePath.match(/^\.+/)?.[0].length ?? 1;
  const moduleRest = modulePath.replace(/^\.+/, "");

  // Go up (dots - 1) directories from current file's directory
  let baseDir = fromDir;
  for (let i = 1; i < dots; i++) {
    baseDir = dirname(baseDir);
  }

  // Convert module.path to module/path
  const moduleFsPath = moduleRest ? moduleRest.replace(/\./g, "/") : "";
  const basePath = moduleFsPath ? join(baseDir, moduleFsPath) : baseDir;

  return resolvePythonPath(basePath, projectPath);
}

function resolvePythonAbsoluteImport(modulePath: string, fromFile: string, projectPath: string): string | null {
  // Convert dots to path separators: foo.bar.baz -> foo/bar/baz
  const fsPath = modulePath.replace(/\./g, "/");

  // Try from project root first
  const directResult = resolvePythonPath(fsPath, projectPath);
  if (directResult) return directResult;

  // Try from ancestor directories of the importing file
  // e.g., for backend/app/api_v1/auth.py importing "app.models",
  // try: backend/app/api_v1/, backend/app/, backend/, until we find app/models.py
  const fromDir = dirname(fromFile);
  const parts = fromDir.split("/").filter(Boolean);

  for (let i = parts.length; i >= 0; i--) {
    const ancestorPath = parts.slice(0, i).join("/") || ".";
    const fullAncestor = join(projectPath, ancestorPath);

    const result = resolvePythonPathFromBase(fsPath, fullAncestor);
    if (result) {
      return relative(projectPath, result);
    }
  }

  return null;
}

function resolvePythonPathFromBase(fsPath: string, basePath: string): string | null {
  // Try as direct .py file, then as package (__init__.py)
  const candidates = [join(basePath, `${fsPath}.py`), join(basePath, fsPath, "__init__.py")];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function resolvePythonPath(basePath: string, projectPath: string): string | null {
  // Try as direct .py file, then as package (__init__.py)
  const candidates = [`${basePath}.py`, join(basePath, "__init__.py")];

  for (const candidate of candidates) {
    const fullPath = join(projectPath, candidate);
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      return relative(projectPath, fullPath);
    }
  }

  return null;
}

function resolveRelativeImport(fromFile: string, importPath: string, projectPath: string): string | null {
  const fromDir = dirname(fromFile);
  const basePath = join(fromDir, importPath);

  // Try various extensions
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

  for (const ext of extensions) {
    const fullPath = join(projectPath, basePath + ext);
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      return relative(projectPath, fullPath);
    }
  }

  return null;
}

function resolveAliasImport(aliasPath: string, projectPath: string): string | null {
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

  for (const ext of extensions) {
    const fullPath = join(projectPath, aliasPath + ext);
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      return relative(projectPath, fullPath);
    }
  }

  return null;
}

// ============================================================================
// Dependency Graph Building
// ============================================================================

export function buildDependencyGraph(projectPath: string, maxFiles: number = 500): DependencyGraph {
  const graph: DependencyGraph = {
    files: new Map(),
    errors: [],
  };

  const files: string[] = [];

  function walk(dir: string, depth: number = 0): void {
    if (depth > 15 || files.length >= maxFiles) return;

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        if (entry.startsWith(".") || IGNORE_DIRS.has(entry)) continue;

        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(entry))) {
          files.push(relative(projectPath, fullPath));
        }
      }
    } catch (error) {
      logError("buildDependencyGraph:walk", error);
    }
  }

  walk(projectPath);

  // Parse imports for each file
  for (const filePath of files) {
    try {
      const content = readFileSync(join(projectPath, filePath), "utf-8");
      const { localImports, externalDeps } = parseImports(content, filePath, projectPath);

      graph.files.set(filePath, {
        path: filePath,
        imports: localImports,
        dependents: [], // Will be populated in second pass
        externalDeps,
      });
    } catch (error) {
      graph.errors.push(`Failed to parse ${filePath}: ${error}`);
    }
  }

  // Second pass: build dependents list
  for (const [filePath, info] of graph.files) {
    for (const importPath of info.imports) {
      const importInfo = graph.files.get(importPath);
      if (importInfo && !importInfo.dependents.includes(filePath)) {
        importInfo.dependents.push(filePath);
      }
    }
  }

  return graph;
}

// ============================================================================
// Dependency Commands
// ============================================================================

export async function showDependencies(db: DatabaseAdapter, projectId: number, projectPath: string, filePath: string): Promise<void> {
  // First check if we have cached dependencies in DB
  const fileRecord = await db.get<{
    dependencies: string | null;
    dependents: string | null;
  }>(
    `SELECT dependencies, dependents FROM files
    WHERE project_id = ? AND path = ?`,
    [projectId, filePath]
  );

  let imports: string[] = [];
  let dependents: string[] = [];
  let externalDeps: string[] = [];

  if (fileRecord?.dependencies || fileRecord?.dependents) {
    imports = safeJsonParse<string[]>(fileRecord.dependencies || "[]", []);
    dependents = safeJsonParse<string[]>(fileRecord.dependents || "[]", []);
  } else {
    // Parse file directly
    const fullPath = join(projectPath, filePath);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const parsed = parseImports(content, filePath, projectPath);
        imports = parsed.localImports;
        externalDeps = parsed.externalDeps;
      } catch (error) {
        console.error(`❌ Failed to parse ${filePath}: ${error}`);
        return;
      }
    } else {
      console.error(`❌ File not found: ${filePath}`);
      return;
    }

    // Find dependents by scanning other files
    const graph = buildDependencyGraph(projectPath, 200);
    const info = graph.files.get(filePath);
    if (info) {
      dependents = info.dependents;
    }
  }

  // Display results
  console.error(`\n📦 Dependencies for: ${filePath}\n`);

  if (imports.length > 0) {
    console.error(`📥 Imports (${imports.length}):`);
    for (const imp of imports) {
      console.error(`   → ${imp}`);
    }
    console.error("");
  } else {
    console.error("📥 No local imports\n");
  }

  if (dependents.length > 0) {
    console.error(`📤 Dependents (${dependents.length}):`);
    for (const dep of dependents) {
      console.error(`   ← ${dep}`);
    }
    console.error("");
  } else {
    console.error("📤 No dependents found\n");
  }

  if (externalDeps.length > 0) {
    console.error(`📦 External Dependencies (${externalDeps.length}):`);
    for (const dep of externalDeps) {
      console.error(`   • ${dep}`);
    }
    console.error("");
  }

  outputJson({
    path: filePath,
    imports,
    dependents,
    externalDeps,
  });
}

// ============================================================================
// File Type & Fragility Inference
// ============================================================================

function inferFileType(filePath: string): string {
  const ext = extname(filePath);
  const name = filePath.split("/").pop() || "";
  const dir = filePath.split("/").slice(0, -1).join("/");

  // Config files
  if (name.includes("config") || name.includes("rc.") || name.endsWith(".json")) return "config";
  if (name === "index.ts" || name === "index.js" || name === "__init__.py") return "route";

  // Test files
  if (name.includes(".test.") || name.includes(".spec.") || dir.includes("test")) return "test";

  // By directory convention
  if (dir.includes("component") || ext === ".vue" || ext === ".svelte") return "component";
  if (dir.includes("util") || dir.includes("lib") || dir.includes("helper")) return "util";
  if (dir.includes("model") || dir.includes("schema")) return "model";
  if (dir.includes("route") || dir.includes("api") || dir.includes("handler")) return "route";
  if (dir.includes("command") || dir.includes("cmd")) return "command";
  if (dir.includes("database") || dir.includes("db")) return "database";

  // By extension
  if (ext === ".css" || ext === ".scss") return "style";
  if (ext === ".py") return "util";

  return "util";
}

function computeFragilityFromGraph(dependentCount: number, _importCount: number): number {
  // Files with many dependents are fragile (changes cascade)
  // Scale: 0 deps = 0, 1-2 = 2, 3-5 = 4, 6-10 = 6, 11+ = 7
  if (dependentCount >= 11) return 7;
  if (dependentCount >= 6) return 6;
  if (dependentCount >= 3) return 4;
  if (dependentCount >= 1) return 2;
  return 0;
}

// ============================================================================
// Refresh Dependencies
// ============================================================================

export async function refreshDependencies(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  maxFiles: number = 2000
): Promise<{ processed: number; updated: number; errors: number }> {
  console.error("🔄 Refreshing dependency graph...\n");

  const graph = buildDependencyGraph(projectPath, maxFiles);
  let updated = 0;

  for (const [filePath, info] of graph.files) {
    try {
      const fileType = inferFileType(filePath);
      const fragility = computeFragilityFromGraph(info.dependents.length, info.imports.length);

      await db.run(
        `INSERT INTO files (project_id, path, type, fragility, dependencies, dependents, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(project_id, path) DO UPDATE SET
          type = COALESCE(files.type, excluded.type),
          fragility = MAX(COALESCE(files.fragility, 0), excluded.fragility),
          dependencies = excluded.dependencies,
          dependents = excluded.dependents,
          updated_at = CURRENT_TIMESTAMP`,
        [projectId, filePath, fileType, fragility, JSON.stringify(info.imports), JSON.stringify(info.dependents)]
      );
      updated++;
    } catch (error) {
      logError("refreshDependencies:update", error);
    }
  }

  console.error(`✅ Processed ${graph.files.size} files`);
  console.error(`✅ Updated ${updated} dependency records`);
  if (graph.errors.length > 0) {
    console.error(`⚠️  ${graph.errors.length} parse errors`);
  }
  console.error("");

  outputJson({
    processed: graph.files.size,
    updated,
    errors: graph.errors.length,
  });

  return {
    processed: graph.files.size,
    updated,
    errors: graph.errors.length,
  };
}

// ============================================================================
// Generate Dependency Graph (Mermaid)
// ============================================================================

export async function generateDependencyGraph(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  focusFile?: string
): Promise<string> {
  const graph = buildDependencyGraph(projectPath, 100);

  let mermaid = "```mermaid\nflowchart LR\n";

  // Create node IDs from file paths
  const nodeId = (path: string): string => {
    return path.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
  };

  const relevantFiles = new Set<string>();

  if (focusFile) {
    // Only show files related to the focus file
    relevantFiles.add(focusFile);
    const info = graph.files.get(focusFile);
    if (info) {
      for (const f of info.imports) relevantFiles.add(f);
      for (const f of info.dependents) relevantFiles.add(f);
    }
  } else {
    // Show all files (limited)
    let count = 0;
    for (const [path] of graph.files) {
      if (count++ >= 30) break;
      relevantFiles.add(path);
    }
  }

  // Add nodes
  for (const path of relevantFiles) {
    const shortName = path.split("/").pop() || path;
    const id = nodeId(path);

    // Get fragility from DB for styling
    const fileRecord = await db.get<{ fragility: number }>(
      `SELECT fragility FROM files WHERE project_id = ? AND path = ?`,
      [projectId, path]
    );

    const fragility = fileRecord?.fragility || 0;

    if (fragility >= 8) {
      mermaid += `  ${id}["🔴 ${shortName}"]\n`;
    } else if (fragility >= 6) {
      mermaid += `  ${id}["🟠 ${shortName}"]\n`;
    } else {
      mermaid += `  ${id}["${shortName}"]\n`;
    }
  }

  // Add edges
  for (const path of relevantFiles) {
    const info = graph.files.get(path);
    if (!info) continue;

    for (const imp of info.imports) {
      if (relevantFiles.has(imp)) {
        mermaid += `  ${nodeId(path)} --> ${nodeId(imp)}\n`;
      }
    }
  }

  mermaid += "```\n";

  console.error("📊 Dependency Graph (Mermaid):\n");
  console.error(mermaid);

  return mermaid;
}

// ============================================================================
// Find Circular Dependencies
// ============================================================================

export function findCircularDependencies(projectPath: string): Array<string[]> {
  const graph = buildDependencyGraph(projectPath, 300);
  const cycles: Array<string[]> = [];
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (stack.has(node)) {
      // Found cycle
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart);
      cycle.push(node);

      // Check if this cycle is already recorded
      const cycleKey = cycle.sort().join("|");
      const existing = cycles.some((c) => c.sort().join("|") === cycleKey);
      if (!existing) {
        cycles.push(cycle);
      }
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    stack.add(node);
    path.push(node);

    const info = graph.files.get(node);
    if (info) {
      for (const dep of info.imports) {
        dfs(dep, [...path]);
      }
    }

    stack.delete(node);
  }

  for (const [path] of graph.files) {
    dfs(path, []);
  }

  if (cycles.length > 0) {
    console.error(`\n⚠️  Found ${cycles.length} circular dependency chain(s):\n`);
    for (const cycle of cycles.slice(0, 10)) {
      console.error(`   ${cycle.join(" → ")}`);
    }
    if (cycles.length > 10) {
      console.error(`   ... and ${cycles.length - 10} more`);
    }
    console.error("");
  } else {
    console.error("\n✅ No circular dependencies found.\n");
  }

  outputJson({ cycles });
  return cycles;
}
