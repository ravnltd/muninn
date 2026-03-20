/**
 * First-Run Bootstrap from Git History
 *
 * Indexes the last 100 commits to populate file knowledge and correlations
 * so the first `recall` call returns useful context.
 * Skips if files table already has >5 entries (already bootstrapped).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseAdapter } from "../database/adapter";
import { buildNewFileMeta } from "../ingestion/git-hook";
import { updateFileCorrelations } from "./correlations";

interface BootstrapResult {
  skipped: boolean;
  files: number;
  correlations: number;
  commits: number;
}

/** Parse git log --name-only output into commit groups */
function parseCommitLog(output: string): Map<string, string[]> {
  const commits = new Map<string, string[]>();
  let currentHash: string | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("COMMIT:")) {
      currentHash = line.slice(7).trim();
      if (currentHash) {
        commits.set(currentHash, []);
      }
    } else if (currentHash && line.trim()) {
      commits.get(currentHash)?.push(line.trim());
    }
  }

  return commits;
}

/** Bootstrap file knowledge from git history */
export async function bootstrap(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
): Promise<BootstrapResult> {
  // Skip if already bootstrapped
  const fileCount = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM files WHERE project_id = ?",
    [projectId],
  );
  if (fileCount && fileCount.cnt > 5) {
    return { skipped: true, files: 0, correlations: 0, commits: 0 };
  }

  // Get last 100 commits with changed files
  const proc = Bun.spawn(
    ["git", "log", "--name-only", "--format=COMMIT:%H", "-100"],
    { stdout: "pipe", stderr: "pipe", cwd },
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  if (!output.trim()) {
    return { skipped: false, files: 0, correlations: 0, commits: 0 };
  }

  const commitGroups = parseCommitLog(output);

  // Collect unique files that still exist on disk
  const allFiles = new Set<string>();
  for (const files of commitGroups.values()) {
    for (const file of files) {
      if (existsSync(resolve(cwd, file))) {
        allFiles.add(file);
      }
    }
  }

  // Insert file metadata
  let filesInserted = 0;
  for (const filePath of allFiles) {
    const existing = await db.get<{ id: number }>(
      "SELECT id FROM files WHERE project_id = ? AND path = ?",
      [projectId, filePath],
    );
    if (existing) continue;

    const meta = buildNewFileMeta(filePath);
    await db.run(
      `INSERT OR IGNORE INTO files (project_id, path, purpose, type, fragility, content_hash, change_count, temperature, first_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 3, ?, 1, 'warm', datetime('now'), datetime('now'), datetime('now'))`,
      [projectId, filePath, meta.purpose, meta.type, meta.contentHash],
    );
    filesInserted++;
  }

  // Build correlations from co-committed files
  let correlationPairs = 0;
  for (const files of commitGroups.values()) {
    const existingFiles = files.filter((f) => allFiles.has(f));
    if (existingFiles.length >= 2) {
      await updateFileCorrelations(db, projectId, existingFiles);
      // Count unique pairs
      correlationPairs +=
        (existingFiles.length * (existingFiles.length - 1)) / 2;
    }
  }

  return {
    skipped: false,
    files: filesInserted,
    correlations: correlationPairs,
    commits: commitGroups.size,
  };
}
