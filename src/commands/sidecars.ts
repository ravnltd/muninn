// @muninn — context in .muninn/context/
/**
 * Knowledge Sidecars
 * Generate per-file context files from muninn's database.
 * Sidecars are tiny instruction sets that Claude reads alongside source code.
 *
 * Architecture:
 *   Database (source of truth)
 *     → muninn sidecars generate
 *   .muninn/context/<path>.md (generated, gitignored)
 *     → PostToolUse hook on Read (auto-injected into Claude's context)
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";

// ============================================================================
// Types
// ============================================================================

interface SidecarData {
  path: string;
  fragility: number;
  fragilityReason: string | null;
  decisions: Array<{ id: number; title: string }>;
  issues: Array<{ id: number; title: string; severity: number }>;
  cochangers: Array<{ path: string; count: number }>;
  blast: { total: number; tests: number; score: number } | null;
}

// ============================================================================
// Comment Syntax
// ============================================================================

const MUNINN_MARKER = "@muninn";
const POINTER_TEXT = "context in .muninn/context/";

function getCommentSyntax(filePath: string): { prefix: string; suffix: string } {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
    case ".go":
    case ".rs":
    case ".c":
    case ".cpp":
    case ".h":
    case ".java":
    case ".swift":
    case ".kt":
    case ".svelte":
    case ".scss":
    case ".css":
      return { prefix: "//", suffix: "" };
    case ".py":
    case ".rb":
    case ".sh":
    case ".bash":
    case ".zsh":
    case ".yaml":
    case ".yml":
    case ".toml":
    case ".r":
      return { prefix: "#", suffix: "" };
    case ".sql":
    case ".lua":
      return { prefix: "--", suffix: "" };
    case ".html":
    case ".xml":
    case ".vue":
      return { prefix: "<!--", suffix: "-->" };
    default:
      return { prefix: "//", suffix: "" };
  }
}

function makePointerComment(filePath: string): string {
  const { prefix, suffix } = getCommentSyntax(filePath);
  const end = suffix ? ` ${suffix}` : "";
  return `${prefix} ${MUNINN_MARKER} \u2014 ${POINTER_TEXT}${end}`;
}

function hasPointerComment(content: string): boolean {
  // Check first 3 lines (shebang might push it down)
  const lines = content.split("\n").slice(0, 3);
  return lines.some((line) => line.includes(MUNINN_MARKER));
}

// ============================================================================
// Sidecar Content Formatter
// ============================================================================

function formatSidecar(data: SidecarData): string {
  const lines: string[] = [];

  // Fragility
  if (data.fragility >= 5) {
    const reason = data.fragilityReason ? ` \u2014 ${data.fragilityReason}` : "";
    lines.push(`FRAGILITY ${data.fragility}/10${reason}`);
  }

  // Co-change rules
  if (data.cochangers.length > 0) {
    lines.push(`RULES:`);
    lines.push(
      `- Always check ${data.cochangers.map((c) => c.path).join(", ")} when editing this file`
    );
  }

  // Decisions
  if (data.decisions.length > 0) {
    lines.push(`DECISIONS:`);
    for (const d of data.decisions) {
      lines.push(`- D${d.id}: ${d.title.substring(0, 80)}`);
    }
  }

  // Issues
  if (data.issues.length > 0) {
    lines.push(`ISSUES:`);
    for (const issue of data.issues) {
      lines.push(`- #${issue.id} (sev ${issue.severity}): ${issue.title.substring(0, 80)}`);
    }
  }

  // Blast radius
  if (data.blast && data.blast.total > 0) {
    lines.push(
      `BLAST: ${data.blast.total} dependents, ${data.blast.tests} tests, score ${Math.round(data.blast.score)}/100`
    );
  }

  return lines.join("\n");
}

// ============================================================================
// Query: Get all qualifying files
// ============================================================================

async function getQualifyingFiles(
  db: DatabaseAdapter,
  projectId: number
): Promise<string[]> {
  const paths = new Set<string>();

  // Files with fragility >= 5
  const fragile = await db.all<{ path: string }>(
    `SELECT path FROM files
     WHERE project_id = ? AND fragility >= 5 AND status = 'active'`,
    [projectId]
  );
  for (const f of fragile) paths.add(f.path);

  // Files referenced by open issues
  const issueFiles = await db.all<{ affected_files: string }>(
    `SELECT affected_files FROM issues
     WHERE project_id = ? AND status = 'open' AND affected_files IS NOT NULL`,
    [projectId]
  );
  for (const row of issueFiles) {
    try {
      const files = JSON.parse(row.affected_files) as string[];
      for (const f of files) paths.add(f);
    } catch {
      // affected_files might be a plain string, not JSON
      if (row.affected_files) paths.add(row.affected_files);
    }
  }

  // Files referenced by active decisions
  const decisionFiles = await db.all<{ affects: string }>(
    `SELECT affects FROM decisions
     WHERE project_id = ? AND status = 'active' AND affects IS NOT NULL`,
    [projectId]
  );
  for (const row of decisionFiles) {
    try {
      const files = JSON.parse(row.affects) as string[];
      for (const f of files) paths.add(f);
    } catch {
      if (row.affects) paths.add(row.affects);
    }
  }

  // Files with strong co-changers
  const strongCorrelations = await db.all<{ file_a: string; file_b: string }>(
    `SELECT DISTINCT file_a, file_b FROM file_correlations
     WHERE project_id = ? AND cochange_count >= 5`,
    [projectId]
  );
  for (const row of strongCorrelations) {
    paths.add(row.file_a);
    paths.add(row.file_b);
  }

  return [...paths];
}

// ============================================================================
// Query: Get sidecar data for a single file
// ============================================================================

async function getSidecarData(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<SidecarData> {
  const [fileRecord, issues, decisions, cochangersA, cochangersB, blast] =
    await Promise.all([
      db.get<{ fragility: number; fragility_reason: string | null }>(
        `SELECT fragility, fragility_reason FROM files
         WHERE project_id = ? AND path = ?`,
        [projectId, filePath]
      ),
      db.all<{ id: number; title: string; severity: number }>(
        `SELECT id, title, severity FROM issues
         WHERE project_id = ? AND status = 'open'
         AND (affected_files LIKE ? OR related_symbols LIKE ?)
         ORDER BY severity DESC LIMIT 3`,
        [projectId, `%${filePath}%`, `%${filePath}%`]
      ),
      db.all<{ id: number; title: string }>(
        `SELECT id, title FROM decisions
         WHERE project_id = ? AND status = 'active'
         AND affects LIKE ?
         ORDER BY created_at DESC LIMIT 3`,
        [projectId, `%${filePath}%`]
      ),
      db.all<{ file_b: string; cochange_count: number }>(
        `SELECT file_b, cochange_count FROM file_correlations
         WHERE project_id = ? AND file_a = ? AND cochange_count >= 3
         ORDER BY cochange_count DESC LIMIT 3`,
        [projectId, filePath]
      ),
      db.all<{ file_a: string; cochange_count: number }>(
        `SELECT file_a, cochange_count FROM file_correlations
         WHERE project_id = ? AND file_b = ? AND cochange_count >= 3
         ORDER BY cochange_count DESC LIMIT 3`,
        [projectId, filePath]
      ),
      db.get<{
        total_affected: number;
        affected_tests: number;
        blast_score: number;
      }>(
        `SELECT total_affected, affected_tests, blast_score FROM blast_summary
         WHERE project_id = ? AND file_path = ?`,
        [projectId, filePath]
      ),
    ]);

  // Merge co-changers from both directions
  const cochangers = [
    ...cochangersA.map((c) => ({ path: c.file_b, count: c.cochange_count })),
    ...cochangersB.map((c) => ({ path: c.file_a, count: c.cochange_count })),
  ]
    .filter((c) => !c.path.startsWith("/") && !c.path.startsWith("."))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    path: filePath,
    fragility: fileRecord?.fragility ?? 0,
    fragilityReason: fileRecord?.fragility_reason ?? null,
    decisions,
    issues,
    cochangers,
    blast: blast
      ? {
          total: blast.total_affected,
          tests: blast.affected_tests,
          score: blast.blast_score,
        }
      : null,
  };
}

// ============================================================================
// Pointer Comment Management
// ============================================================================

// File extensions that should NOT get pointer comments
const SKIP_POINTER_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".lock", ".yaml", ".yml", ".toml",
  ".env", ".gitignore", ".editorconfig", ".prettierrc",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
  ".woff", ".woff2", ".ttf", ".eot",
  "",  // no extension
]);

function shouldAddPointer(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (SKIP_POINTER_EXTENSIONS.has(ext)) return false;
  // Skip dotfiles
  const basename = filePath.split("/").pop() ?? "";
  if (basename.startsWith(".")) return false;
  return true;
}

function addPointerComment(projectPath: string, filePath: string): boolean {
  if (!shouldAddPointer(filePath)) return false;
  const fullPath = join(projectPath, filePath);
  if (!existsSync(fullPath)) return false;

  try {
    const content = readFileSync(fullPath, "utf-8");
    if (hasPointerComment(content)) return false; // Already has it

    const comment = makePointerComment(filePath);
    const lines = content.split("\n");

    // Insert after shebang if present
    if (lines[0]?.startsWith("#!")) {
      lines.splice(1, 0, comment);
    } else {
      lines.unshift(comment);
    }

    writeFileSync(fullPath, lines.join("\n"));
    return true;
  } catch {
    return false;
  }
}

function removePointerComment(projectPath: string, filePath: string): boolean {
  const fullPath = join(projectPath, filePath);
  if (!existsSync(fullPath)) return false;

  try {
    const content = readFileSync(fullPath, "utf-8");
    if (!hasPointerComment(content)) return false;

    const lines = content.split("\n");
    const filtered = lines.filter((line) => !line.includes(MUNINN_MARKER));
    writeFileSync(fullPath, filtered.join("\n"));
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Commands
// ============================================================================

const CONTEXT_DIR = ".muninn/context";

export async function sidecarsGenerate(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string
): Promise<void> {
  const contextDir = join(projectPath, CONTEXT_DIR);

  // Get qualifying files
  const qualifyingPaths = await getQualifyingFiles(db, projectId);

  // Filter to files that actually exist on disk
  const existingPaths = qualifyingPaths.filter((p) => {
    const full = join(projectPath, p);
    return existsSync(full) && statSync(full).isFile();
  });

  let generated = 0;
  let skipped = 0;
  let pointersAdded = 0;

  // Generate sidecars
  for (const filePath of existingPaths) {
    const data = await getSidecarData(db, projectId, filePath);
    const content = formatSidecar(data);

    // Skip if no meaningful content
    if (content.trim().length === 0) {
      skipped++;
      continue;
    }

    // Write sidecar
    const sidecarPath = join(contextDir, `${filePath}.md`);
    mkdirSync(dirname(sidecarPath), { recursive: true });
    writeFileSync(sidecarPath, content);
    generated++;

    // Add pointer comment to source file
    if (addPointerComment(projectPath, filePath)) {
      pointersAdded++;
    }
  }

  // Clean up sidecars for files that no longer qualify
  const cleaned = cleanStaleContext(contextDir, existingPaths, projectPath);

  console.error(
    `[sidecars] ${generated} generated, ${skipped} skipped, ${cleaned} cleaned, ${pointersAdded} pointers added`
  );
  console.log(
    JSON.stringify({ generated, skipped, cleaned, pointersAdded })
  );
}

export async function sidecarsClean(projectPath: string): Promise<void> {
  const contextDir = join(projectPath, CONTEXT_DIR);
  if (!existsSync(contextDir)) {
    console.error("[sidecars] No context directory found");
    return;
  }

  // Remove all sidecar files
  let removed = 0;
  removeRecursive(contextDir, (filePath) => {
    removed++;
    // Also remove pointer comments from source files
    const relPath = relative(contextDir, filePath).replace(/\.md$/, "");
    removePointerComment(projectPath, relPath);
  });

  // Remove the context directory
  rmSync(contextDir, { recursive: true, force: true });

  console.error(`[sidecars] Cleaned ${removed} sidecar(s)`);
  console.log(JSON.stringify({ removed }));
}

export async function sidecarsShow(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<void> {
  const data = await getSidecarData(db, projectId, filePath);
  const content = formatSidecar(data);

  if (content.trim().length === 0) {
    console.error(`[sidecars] No context for ${filePath}`);
  } else {
    console.log(`[muninn:${filePath}]`);
    console.log(content);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Remove sidecars that no longer have qualifying source files
 */
function cleanStaleContext(
  contextDir: string,
  qualifyingPaths: string[],
  projectPath: string
): number {
  if (!existsSync(contextDir)) return 0;

  const qualifyingSet = new Set(qualifyingPaths);
  let cleaned = 0;

  walkDir(contextDir, (sidecarPath) => {
    const relFromContext = relative(contextDir, sidecarPath);
    const sourcePath = relFromContext.replace(/\.md$/, "");

    if (!qualifyingSet.has(sourcePath)) {
      unlinkSync(sidecarPath);
      cleaned++;
      // Remove pointer comment from source
      removePointerComment(projectPath, sourcePath);
    }
  });

  return cleaned;
}

function walkDir(dir: string, callback: (path: string) => void): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      callback(fullPath);
    }
  }
}

function removeRecursive(
  dir: string,
  onFile: (path: string) => void
): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      removeRecursive(fullPath, onFile);
    } else if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}
