/**
 * v10 Context Cache — Precomputed Push Delivery
 *
 * Muninn's hooks never hit the database synchronously. Instead, this module
 * precomputes everything a hook might inject into Claude's context and writes
 * it to `.muninn/context/`. Hooks are pure-bash file reads: <100ms, and they
 * degrade to silence when a file is missing.
 *
 * Layout:
 *   .muninn/context/session-start.md   — orientation blob (SessionStart hook)
 *   .muninn/context/files/<path>.md    — per-file bundle (PostToolUse Read hook)
 *   .muninn/context/meta.json          — generation metadata + user notices
 *
 * Principles:
 *   - Conditional silence: a file gets a bundle only when something non-obvious
 *     exists (fragility >= 6, decisions, open issues, or strong co-changers).
 *   - Full fidelity: complete sentences, full decision text with reasoning.
 *     No sigils, no truncated-mid-word slices.
 *   - Refresh is background-only: called from hooks with `&`, from session end,
 *     or via `muninn context refresh`. Never on a hook's critical path.
 */

import type { DatabaseAdapter } from "../database/adapter.js";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

// ============================================================================
// Types
// ============================================================================

interface FileBundleData {
  path: string;
  fragility: number;
  fragilityReason: string | null;
  purpose: string | null;
  decisions: Array<{ id: number; title: string; decision: string; reasoning: string | null; decidedAt: string }>;
  issues: Array<{ id: number; title: string; description: string | null; severity: number; type: string }>;
  cochangers: Array<{ path: string; count: number }>;
  blast: { total: number; tests: number } | null;
}

export interface RefreshResult {
  bundles: number;
  skipped: number;
  cleaned: number;
}

const CONTEXT_DIR = ".muninn/context";
const FILES_DIR = "files";
/** Bundle qualification thresholds — below these, silence. */
const FRAGILITY_THRESHOLD = 6;
const COCHANGE_THRESHOLD = 5;
/** Caps to keep a single injection bounded (~400 tokens worst case). */
const MAX_DECISIONS = 3;
const MAX_ISSUES = 3;
const MAX_COCHANGERS = 4;
const DECISION_TEXT_CAP = 400;
const ISSUE_TEXT_CAP = 300;

// ============================================================================
// Refresh Orchestrator
// ============================================================================

export async function refreshContextCache(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
): Promise<RefreshResult> {
  const contextDir = join(projectPath, CONTEXT_DIR);
  const filesDir = join(contextDir, FILES_DIR);
  mkdirSync(filesDir, { recursive: true });

  const [sessionStart, bundleResult] = await Promise.all([
    generateSessionStart(db, projectId),
    generateFileBundles(db, projectId, projectPath, filesDir),
  ]);

  writeFileSync(join(contextDir, "session-start.md"), sessionStart);
  writeMeta(contextDir, bundleResult);
  const cleaned = cleanLegacySidecars(contextDir);

  return { ...bundleResult, cleaned };
}

/** Refresh the bundle for a single file (post-edit fast path). */
export async function refreshFileBundle(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  filePath: string,
): Promise<boolean> {
  const filesDir = join(projectPath, CONTEXT_DIR, FILES_DIR);
  const data = await getFileBundleData(db, projectId, filePath);
  const content = formatFileBundle(data);
  const bundlePath = join(filesDir, `${filePath}.md`);

  if (!content) {
    if (existsSync(bundlePath)) unlinkSync(bundlePath);
    return false;
  }
  mkdirSync(dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, content);
  return true;
}

function writeMeta(contextDir: string, result: { bundles: number; skipped: number }): void {
  const meta = {
    generatedAt: new Date().toISOString(),
    bundles: result.bundles,
    skipped: result.skipped,
  };
  writeFileSync(join(contextDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

// ============================================================================
// Session-Start Orientation (~300 tokens, orientation not accounting)
// ============================================================================

async function generateSessionStart(db: DatabaseAdapter, projectId: number): Promise<string> {
  const [project, lastSession, fragileFiles, decisions, issues] = await Promise.all([
    db.get<{ name: string }>(`SELECT name FROM projects WHERE id = ?`, [projectId]),
    db.get<{ goal: string | null; outcome: string | null; next_steps: string | null; ended_at: string }>(
      `SELECT goal, outcome, next_steps, ended_at FROM sessions
       WHERE project_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`,
      [projectId],
    ),
    db.all<{ path: string; fragility: number; fragility_reason: string | null }>(
      `SELECT path, fragility, fragility_reason FROM files
       WHERE project_id = ? AND fragility >= 7 AND status = 'active'
       ORDER BY fragility DESC LIMIT 5`,
      [projectId],
    ),
    db.all<{ id: number; title: string; decision: string }>(
      `SELECT id, title, decision FROM decisions
       WHERE project_id = ? AND status = 'active'
       ORDER BY decided_at DESC LIMIT 5`,
      [projectId],
    ),
    db.all<{ id: number; title: string; severity: number; type: string }>(
      `SELECT id, title, severity, type FROM issues
       WHERE project_id = ? AND status = 'open'
       ORDER BY severity DESC LIMIT 5`,
      [projectId],
    ),
  ]);

  const lines: string[] = [`## Muninn orientation — ${project?.name ?? "project"}`];

  if (lastSession?.goal || lastSession?.outcome) {
    lines.push("");
    lines.push(`Last session: ${sentence(lastSession.goal)} ${lastSession.outcome ? `Outcome: ${sentence(lastSession.outcome)}` : ""}`.trim());
    if (lastSession.next_steps) lines.push(`Next steps: ${sentence(lastSession.next_steps)}`);
  }

  if (fragileFiles.length > 0) {
    lines.push("", "Fragile files (check context before editing):");
    for (const f of fragileFiles) {
      lines.push(`- ${f.path} (${f.fragility}/10)${f.fragility_reason ? ` — ${firstSentence(f.fragility_reason)}` : ""}`);
    }
  }

  if (decisions.length > 0) {
    lines.push("", "Active decisions (most recent):");
    for (const d of decisions) {
      lines.push(`- D${d.id}: ${d.title}${differs(d.title, d.decision) ? ` — ${firstSentence(d.decision)}` : ""}`);
    }
  }

  if (issues.length > 0) {
    lines.push("", "Open issues:");
    for (const i of issues) {
      lines.push(`- #${i.id} (sev ${i.severity}, ${i.type}): ${i.title}`);
    }
  }

  lines.push("", "Per-file context is injected automatically when you read files. For anything else: recall({ query|task|files }).");
  return `${lines.join("\n")}\n`;
}

// ============================================================================
// Per-File Bundles
// ============================================================================

async function generateFileBundles(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  filesDir: string,
): Promise<{ bundles: number; skipped: number }> {
  // Bulk-load once — sqld serializes requests, so per-file queries take minutes.
  const project = await loadProjectContextData(db, projectId);
  const candidates = qualifyingPathsFrom(project);
  const onDisk = candidates.filter((p) => {
    const full = join(projectPath, p);
    return existsSync(full) && statSync(full).isFile();
  });

  let bundles = 0;
  let skipped = candidates.length - onDisk.length;
  const written = new Set<string>();

  for (const filePath of onDisk) {
    const content = formatFileBundle(buildBundleData(filePath, project));
    if (!content) {
      skipped++;
      continue;
    }
    const bundlePath = join(filesDir, `${filePath}.md`);
    mkdirSync(dirname(bundlePath), { recursive: true });
    writeFileSync(bundlePath, content);
    written.add(filePath);
    bundles++;
  }

  pruneStaleBundles(filesDir, written);
  return { bundles, skipped };
}

// ============================================================================
// Bulk Loading — 6 queries total for the whole project, matched in JS
// ============================================================================

interface ProjectContextData {
  files: Map<string, { fragility: number; fragilityReason: string | null; purpose: string | null }>;
  decisions: Array<{ id: number; title: string; decision: string; reasoning: string | null; decidedAt: string; affects: string[] }>;
  issues: Array<{ id: number; title: string; description: string | null; severity: number; type: string; affected: string[] }>;
  correlations: Array<{ fileA: string; fileB: string; count: number }>;
  blast: Map<string, { total: number; tests: number }>;
}

async function loadProjectContextData(db: DatabaseAdapter, projectId: number): Promise<ProjectContextData> {
  const [files, decisions, issues, correlations, blast] = await Promise.all([
    db.all<{ path: string; fragility: number; fragility_reason: string | null; purpose: string | null }>(
      `SELECT path, fragility, fragility_reason, purpose FROM files
       WHERE project_id = ? AND status = 'active'`,
      [projectId],
    ),
    db.all<{ id: number; title: string; decision: string; reasoning: string | null; decided_at: string; affects: string | null }>(
      `SELECT id, title, decision, reasoning, decided_at, affects FROM decisions
       WHERE project_id = ? AND status = 'active' ORDER BY decided_at DESC`,
      [projectId],
    ),
    db.all<{ id: number; title: string; description: string | null; severity: number; type: string; affected_files: string | null; related_symbols: string | null }>(
      `SELECT id, title, description, severity, type, affected_files, related_symbols FROM issues
       WHERE project_id = ? AND status = 'open' ORDER BY severity DESC`,
      [projectId],
    ),
    db.all<{ file_a: string; file_b: string; cochange_count: number }>(
      `SELECT file_a, file_b, cochange_count FROM file_correlations
       WHERE project_id = ? AND cochange_count >= 3`,
      [projectId],
    ),
    db.all<{ file_path: string; total_affected: number; affected_tests: number }>(
      `SELECT file_path, total_affected, affected_tests FROM blast_summary
       WHERE project_id = ? AND total_affected > 0`,
      [projectId],
    ),
  ]);

  return {
    files: new Map(files.map((f) => [f.path, {
      fragility: f.fragility, fragilityReason: f.fragility_reason, purpose: f.purpose,
    }])),
    decisions: decisions.map((d) => ({
      id: d.id, title: d.title, decision: d.decision, reasoning: d.reasoning,
      decidedAt: d.decided_at, affects: jsonPaths(d.affects),
    })),
    issues: issues.map((i) => ({
      id: i.id, title: i.title, description: i.description, severity: i.severity,
      type: i.type, affected: [...jsonPaths(i.affected_files), ...jsonPaths(i.related_symbols)],
    })),
    correlations: correlations.map((c) => ({ fileA: c.file_a, fileB: c.file_b, count: c.cochange_count })),
    blast: new Map(blast.map((b) => [b.file_path, { total: b.total_affected, tests: b.affected_tests }])),
  };
}

function qualifyingPathsFrom(project: ProjectContextData): string[] {
  const paths = new Set<string>();
  for (const [path, f] of project.files) {
    if (f.fragility >= FRAGILITY_THRESHOLD) paths.add(path);
  }
  for (const d of project.decisions) for (const p of d.affects) paths.add(p);
  for (const i of project.issues) for (const p of i.affected) paths.add(p);
  for (const c of project.correlations) {
    if (c.count >= COCHANGE_THRESHOLD) {
      paths.add(c.fileA);
      paths.add(c.fileB);
    }
  }
  return [...paths].filter(isProjectRelativePath);
}

function buildBundleData(filePath: string, project: ProjectContextData): FileBundleData {
  const file = project.files.get(filePath);
  // Match semantics mirror the SQL LIKE %path% used by the single-file path
  const decisions = project.decisions
    .filter((d) => d.affects.some((a) => a.includes(filePath)))
    .slice(0, MAX_DECISIONS);
  const issues = project.issues
    .filter((i) => i.affected.some((a) => a.includes(filePath)))
    .slice(0, MAX_ISSUES);
  const cochangers = project.correlations
    .filter((c) => c.fileA === filePath || c.fileB === filePath)
    .map((c) => ({ path: c.fileA === filePath ? c.fileB : c.fileA, count: c.count }))
    .filter((c) => isProjectRelativePath(c.path))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_COCHANGERS);

  return {
    path: filePath,
    fragility: file?.fragility ?? 0,
    fragilityReason: file?.fragilityReason ?? null,
    purpose: file?.purpose ?? null,
    decisions: decisions.map((d) => ({
      id: d.id, title: d.title, decision: d.decision, reasoning: d.reasoning, decidedAt: d.decidedAt,
    })),
    issues: issues.map((i) => ({
      id: i.id, title: i.title, description: i.description, severity: i.severity, type: i.type,
    })),
    cochangers,
    blast: project.blast.get(filePath) ?? null,
  };
}

function jsonPaths(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
  } catch {
    // Plain string, not JSON
  }
  return [raw];
}

async function getFileBundleData(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string,
): Promise<FileBundleData> {
  const [fileRecord, issues, decisions, cochangersA, cochangersB, blast] = await Promise.all([
    db.get<{ fragility: number; fragility_reason: string | null; purpose: string | null }>(
      `SELECT fragility, fragility_reason, purpose FROM files WHERE project_id = ? AND path = ?`,
      [projectId, filePath],
    ),
    db.all<{ id: number; title: string; description: string | null; severity: number; type: string }>(
      `SELECT id, title, description, severity, type FROM issues
       WHERE project_id = ? AND status = 'open'
       AND (affected_files LIKE ? OR related_symbols LIKE ?)
       ORDER BY severity DESC LIMIT ?`,
      [projectId, `%${filePath}%`, `%${filePath}%`, MAX_ISSUES],
    ),
    db.all<{ id: number; title: string; decision: string; reasoning: string | null; decided_at: string }>(
      `SELECT id, title, decision, reasoning, decided_at FROM decisions
       WHERE project_id = ? AND status = 'active' AND affects LIKE ?
       ORDER BY decided_at DESC LIMIT ?`,
      [projectId, `%${filePath}%`, MAX_DECISIONS],
    ),
    db.all<{ file_b: string; cochange_count: number }>(
      `SELECT file_b, cochange_count FROM file_correlations
       WHERE project_id = ? AND file_a = ? AND cochange_count >= 3
       ORDER BY cochange_count DESC LIMIT ?`,
      [projectId, filePath, MAX_COCHANGERS],
    ),
    db.all<{ file_a: string; cochange_count: number }>(
      `SELECT file_a, cochange_count FROM file_correlations
       WHERE project_id = ? AND file_b = ? AND cochange_count >= 3
       ORDER BY cochange_count DESC LIMIT ?`,
      [projectId, filePath, MAX_COCHANGERS],
    ),
    db.get<{ total_affected: number; affected_tests: number }>(
      `SELECT total_affected, affected_tests FROM blast_summary
       WHERE project_id = ? AND file_path = ?`,
      [projectId, filePath],
    ),
  ]);

  const cochangers = [
    ...cochangersA.map((c) => ({ path: c.file_b, count: c.cochange_count })),
    ...cochangersB.map((c) => ({ path: c.file_a, count: c.cochange_count })),
  ]
    .filter((c) => isProjectRelativePath(c.path))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_COCHANGERS);

  return {
    path: filePath,
    fragility: fileRecord?.fragility ?? 0,
    fragilityReason: fileRecord?.fragility_reason ?? null,
    purpose: fileRecord?.purpose ?? null,
    decisions: decisions.map((d) => ({
      id: d.id, title: d.title, decision: d.decision, reasoning: d.reasoning, decidedAt: d.decided_at,
    })),
    issues,
    cochangers,
    blast: blast && blast.total_affected > 0 ? { total: blast.total_affected, tests: blast.affected_tests } : null,
  };
}

// ============================================================================
// Formatter — full fidelity, conditional silence
// ============================================================================

/** Returns null when there is nothing non-obvious to say (= inject nothing). */
export function formatFileBundle(data: FileBundleData): string | null {
  const fragile = data.fragility >= FRAGILITY_THRESHOLD;
  const strongCochange = data.cochangers.some((c) => c.count >= COCHANGE_THRESHOLD);
  if (!fragile && data.decisions.length === 0 && data.issues.length === 0 && !strongCochange) {
    return null;
  }

  const lines: string[] = [];

  if (fragile) {
    const reason = data.fragilityReason ? ` — ${data.fragilityReason.trim()}` : "";
    lines.push(`Fragility ${data.fragility}/10${reason}`);
  }

  if (data.cochangers.length > 0) {
    const list = data.cochangers.map((c) => `${c.path} (${c.count}x)`).join(", ");
    lines.push(`Usually changes together with: ${list}. Check them before finishing.`);
  }

  if (data.decisions.length > 0) {
    lines.push("", "Decisions that govern this file:");
    for (const d of data.decisions) {
      const body = differs(d.title, d.decision) ? ` — ${cap(d.decision, DECISION_TEXT_CAP)}` : "";
      const why = d.reasoning ? ` Why: ${cap(d.reasoning, DECISION_TEXT_CAP)}` : "";
      lines.push(`- D${d.id} (${d.decidedAt.slice(0, 10)}): ${d.title}${body}${why}`);
    }
  }

  if (data.issues.length > 0) {
    lines.push("", "Open issues touching this file:");
    for (const i of data.issues) {
      const desc = i.description ? ` — ${cap(i.description, ISSUE_TEXT_CAP)}` : "";
      lines.push(`- #${i.id} (sev ${i.severity}, ${i.type}): ${i.title}${desc}`);
    }
  }

  if (data.blast) {
    lines.push("", `Blast radius: ${data.blast.total} dependent file(s), ${data.blast.tests} test(s) affected.`);
  }

  return `${lines.join("\n")}\n`;
}

// ============================================================================
// Cleanup
// ============================================================================

/** Remove bundles for files that no longer qualify. */
function pruneStaleBundles(filesDir: string, written: Set<string>): void {
  walkMarkdown(filesDir, (bundlePath) => {
    const sourcePath = relative(filesDir, bundlePath).replace(/\.md$/, "");
    if (!written.has(sourcePath)) unlinkSync(bundlePath);
  });
}

/**
 * Remove the legacy sidecar layout: v9 wrote `.muninn/context/<path>.md` at the
 * top level (alongside directories mirroring the source tree). v10 owns
 * `files/` plus reserved top-level names; everything else is stale.
 */
function cleanLegacySidecars(contextDir: string): number {
  const reserved = new Set([FILES_DIR, "session-start.md", "global.md", "map.json", "meta.json"]);
  let cleaned = 0;
  if (!existsSync(contextDir)) return 0;

  for (const entry of readdirSync(contextDir, { withFileTypes: true })) {
    if (reserved.has(entry.name)) continue;
    rmSync(join(contextDir, entry.name), { recursive: true, force: true });
    cleaned++;
  }
  return cleaned;
}

// ============================================================================
// Helpers
// ============================================================================

/** Reject absolute paths, dotfiles at root, and traversal — bundles mirror the repo tree. */
function isProjectRelativePath(p: string): boolean {
  return !p.startsWith("/") && !p.startsWith(".") && !p.includes("..");
}

function cap(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

function firstSentence(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  const end = clean.search(/[.!?](\s|$)/);
  return end > 0 ? clean.slice(0, end + 1) : cap(clean, 160);
}

function sentence(text: string | null): string {
  if (!text) return "";
  const clean = text.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

/** True when body text adds information beyond the title (avoids echoing title twice). */
function differs(title: string, body: string): boolean {
  const t = title.trim().toLowerCase();
  const b = body.trim().toLowerCase();
  return b.length > t.length + 10 && !b.startsWith(t.slice(0, Math.min(t.length, 40)));
}

function walkMarkdown(dir: string, callback: (path: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(fullPath, callback);
    else if (entry.isFile() && entry.name.endsWith(".md")) callback(fullPath);
  }
}
