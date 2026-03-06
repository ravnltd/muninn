/**
 * v9 Auto-Capture — Post-Edit Intelligence
 *
 * Runs after each file edit to automatically:
 * 1. Create or update file records (purpose, type, content hash)
 * 2. Track co-changes within the session
 * 3. Update session files_touched
 *
 * Design: fast, non-blocking, fire-and-forget.
 * No LLM calls — purely structural inference.
 */

import { createHash } from "node:crypto";
import type { DatabaseAdapter } from "../database/adapter.js";
import { silentCatch } from "../utils/silent-catch.js";

// ============================================================================
// Types
// ============================================================================

interface CaptureResult {
  file: string;
  action: "created" | "updated" | "tracked";
  cochangesUpdated: number;
}

// ============================================================================
// File Type Inference
// ============================================================================

const TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\.test\.|\.spec\.|__tests__/, "test"],
  [/\.config\.|\.rc\.|\bconfig\//, "config"],
  [/components?\//, "component"],
  [/hooks?\//, "hook"],
  [/utils?\/|helpers?\/|lib\//, "util"],
  [/routes?\/|api\//, "api"],
  [/middleware/, "middleware"],
  [/types?\.ts|\.d\.ts|interfaces?\//, "types"],
  [/migrations?\//, "migration"],
  [/schemas?\//, "schema"],
  [/commands?\//, "command"],
  [/database|db\//, "database"],
  [/index\.[jt]sx?$/, "entry"],
];

function inferType(filePath: string): string {
  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(filePath)) return type;
  }
  return "module";
}

function inferPurpose(filePath: string): string {
  // Extract meaningful name from path
  const parts = filePath.split("/");
  const filename = parts[parts.length - 1]
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]/g, " ");

  const dir = parts.length > 1 ? parts[parts.length - 2] : "";
  if (dir && dir !== "src") {
    return `${dir} — ${filename}`;
  }
  return filename;
}

// ============================================================================
// Content Hash
// ============================================================================

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function capture(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string,
  fileContent?: string,
): Promise<CaptureResult> {
  const contentHash = fileContent ? hashContent(fileContent) : null;

  // Check if file record exists
  const existing = await db.get<{ id: number; content_hash: string | null }>(
    `SELECT id, content_hash FROM files WHERE project_id = ? AND path = ?`,
    [projectId, filePath],
  );

  let action: CaptureResult["action"];

  if (!existing) {
    // Create new file record
    const type = inferType(filePath);
    const purpose = inferPurpose(filePath);

    await db.run(
      `INSERT INTO files (project_id, path, purpose, type, fragility, content_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, 'active', datetime('now'), datetime('now'))`,
      [projectId, filePath, purpose, type, contentHash],
    );

    // Update FTS (fire-and-forget)
    db.run(
      `INSERT INTO fts_files (rowid, path, purpose) VALUES (last_insert_rowid(), ?, ?)`,
      [filePath, purpose],
    ).catch(silentCatch("capture:fts"));

    action = "created";
  } else if (contentHash && contentHash !== existing.content_hash) {
    // File changed — update hash and timestamp
    await db.run(
      `UPDATE files SET content_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      [contentHash, existing.id],
    );
    action = "updated";
  } else {
    action = "tracked";
  }

  // Track co-changes and session in parallel
  const cochangesUpdated = await updateCochanges(db, projectId, filePath);
  trackSession(db, projectId, filePath).catch(silentCatch("capture:session"));

  return { file: filePath, action, cochangesUpdated };
}

// ============================================================================
// Co-Change Tracking
// ============================================================================

async function updateCochanges(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string,
): Promise<number> {
  // Find other files edited in the current session
  const activeSession = await db.get<{ id: number; files_touched: string | null }>(
    `SELECT id, files_touched FROM sessions
     WHERE project_id = ? AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [projectId],
  );

  if (!activeSession?.files_touched) return 0;

  let filesTouched: string[];
  try {
    filesTouched = JSON.parse(activeSession.files_touched);
  } catch {
    return 0;
  }

  // Don't correlate with self
  const others = filesTouched.filter((f) => f !== filePath);
  if (others.length === 0) return 0;

  let updated = 0;
  for (const other of others) {
    // Normalize order so (a,b) and (b,a) are the same
    const [fileA, fileB] = [filePath, other].sort();

    try {
      await db.run(
        `INSERT INTO file_correlations (project_id, file_a, file_b, cochange_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(project_id, file_a, file_b) DO UPDATE SET cochange_count = cochange_count + 1`,
        [projectId, fileA, fileB],
      );
      updated++;
    } catch {
      // Correlation table might not exist in older schemas
    }
  }

  return updated;
}

// ============================================================================
// Session Tracking
// ============================================================================

async function trackSession(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string,
): Promise<void> {
  const activeSession = await db.get<{ id: number; files_touched: string | null }>(
    `SELECT id, files_touched FROM sessions
     WHERE project_id = ? AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [projectId],
  );

  if (!activeSession) return;

  let filesTouched: string[];
  try {
    filesTouched = JSON.parse(activeSession.files_touched || "[]");
  } catch {
    filesTouched = [];
  }

  if (!filesTouched.includes(filePath)) {
    filesTouched.push(filePath);
    await db.run(
      `UPDATE sessions SET files_touched = ? WHERE id = ?`,
      [JSON.stringify(filesTouched), activeSession.id],
    );
  }
}

// ============================================================================
// Batch Capture (for multiple files edited together)
// ============================================================================

export async function captureBatch(
  db: DatabaseAdapter,
  projectId: number,
  files: Array<{ path: string; content?: string }>,
): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];
  for (const file of files) {
    const result = await capture(db, projectId, file.path, file.content);
    results.push(result);
  }
  return results;
}

// ============================================================================
// Formatter
// ============================================================================

export function formatCaptureResult(result: CaptureResult): string {
  const icon = result.action === "created" ? "+" : result.action === "updated" ? "~" : ".";
  const co = result.cochangesUpdated > 0 ? ` (${result.cochangesUpdated} co-changes)` : "";
  return `${icon} ${result.file}${co}`;
}
