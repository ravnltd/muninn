/**
 * v9 Track — Issue Management
 *
 * Simplified issue tracking with add/resolve lifecycle.
 * Kept separate from remember because issues have state transitions.
 */

import type { DatabaseAdapter } from "../database/adapter.js";
import { silentCatch } from "../utils/silent-catch.js";

// ============================================================================
// Types
// ============================================================================

interface TrackAddInput {
  action: "add";
  title: string;
  description?: string;
  severity?: number;
  type?: "bug" | "debt" | "security" | "performance";
  files?: string[];
}

interface TrackResolveInput {
  action: "resolve";
  id: number;
  resolution: string;
}

type TrackInput = TrackAddInput | TrackResolveInput;

interface TrackResult {
  action: "added" | "resolved";
  id: number;
  title: string;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function track(
  db: DatabaseAdapter,
  projectId: number,
  input: TrackInput,
): Promise<TrackResult> {
  if (input.action === "add") {
    return trackAdd(db, projectId, input);
  }
  return trackResolve(db, input);
}

async function trackAdd(
  db: DatabaseAdapter,
  projectId: number,
  input: TrackAddInput,
): Promise<TrackResult> {
  const severity = input.severity ?? 5;
  const type = input.type ?? "bug";

  const result = await db.run(
    `INSERT INTO issues (project_id, title, description, severity, type, status, affected_files, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, datetime('now'))`,
    [
      projectId,
      input.title,
      input.description ?? null,
      severity,
      type,
      input.files ? JSON.stringify(input.files) : null,
    ],
  );

  const id = Number(result.lastInsertRowid ?? 0);

  // Update FTS (fire-and-forget)
  db.run(
    `INSERT INTO fts_issues (rowid, title, description, workaround, resolution) VALUES (?, ?, ?, ?, ?)`,
    [id, input.title, input.description ?? "", "", ""],
  ).catch(silentCatch("track:fts"));

  // Generate embedding (fire-and-forget)
  try {
    import("../database/queries/vector.js")
      .then(({ updateEmbedding }) =>
        import("../embeddings/index.js")
          .then(({ generateEmbedding }) =>
            generateEmbedding(`${input.title} ${input.description ?? ""}`)
              .then((emb) => {
                if (emb) updateEmbedding(db, "issues", id, emb).catch(silentCatch("track:embedding"));
              }),
          ),
      )
      .catch(silentCatch("track:embedding-import"));
  } catch {
    // Not critical
  }

  return { action: "added", id, title: input.title };
}

async function trackResolve(
  db: DatabaseAdapter,
  input: TrackResolveInput,
): Promise<TrackResult> {
  // Get issue title before resolving
  const issue = await db.get<{ title: string }>(
    `SELECT title FROM issues WHERE id = ?`,
    [input.id],
  );

  if (!issue) {
    throw new Error(`Issue #${input.id} not found`);
  }

  await db.run(
    `UPDATE issues SET status = 'resolved', resolution = ?, resolved_at = datetime('now')
     WHERE id = ?`,
    [input.resolution, input.id],
  );

  return { action: "resolved", id: input.id, title: issue.title };
}

// ============================================================================
// Formatter
// ============================================================================

export function formatTrackResult(result: TrackResult): string {
  if (result.action === "added") {
    return `Issue #${result.id} tracked: ${result.title}`;
  }
  return `Issue #${result.id} resolved: ${result.title}`;
}
