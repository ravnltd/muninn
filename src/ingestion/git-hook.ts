/**
 * Git Post-Commit Ingester
 *
 * Processes git commits to automatically update file knowledge and correlations.
 * Called from .git/hooks/post-commit via `muninn ingest commit`.
 * Runs async in background — commit completes immediately.
 */

import type { DatabaseAdapter } from "../database/adapter";
import { updateFileCorrelations } from "../commands/correlations";

// ============================================================================
// Types
// ============================================================================

interface CommitInfo {
  hash: string;
  author: string;
  message: string;
  files: FileChange[];
  totalInsertions: number;
  totalDeletions: number;
  committedAt: string;
}

interface FileChange {
  path: string;
  insertions: number;
  deletions: number;
}

// ============================================================================
// Git Data Extraction
// ============================================================================

/** Parse git log output for the latest commit */
export function parseGitLog(logOutput: string): Pick<CommitInfo, "hash" | "author" | "message" | "committedAt"> | null {
  const lines = logOutput.trim().split("\n");
  if (lines.length < 3) return null;

  // Format: hash\nauthor\ndate\nmessage (possibly multiline)
  const hash = lines[0].trim();
  const author = lines[1].trim();
  const committedAt = lines[2].trim();
  const message = lines.slice(3).join("\n").trim();

  if (!hash || hash.length < 7) return null;

  return { hash, author, message, committedAt };
}

/** Parse git diff --numstat output */
export function parseNumstat(numstatOutput: string): FileChange[] {
  const files: FileChange[] = [];

  for (const line of numstatOutput.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const insertions = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
    const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
    const path = parts[2];

    if (path) {
      files.push({
        path,
        insertions: Number.isNaN(insertions) ? 0 : insertions,
        deletions: Number.isNaN(deletions) ? 0 : deletions,
      });
    }
  }

  return files;
}

// ============================================================================
// Commit Processing
// ============================================================================

/**
 * Process a git commit: store metadata, update file knowledge, update correlations.
 * Called by `muninn ingest commit` CLI command.
 */
export async function processCommit(db: DatabaseAdapter, projectId: number): Promise<string> {
  // Get commit info from git
  const logOutput = await runGitCommand(
    "git", ["log", "-1", "--format=%H%n%an%n%aI%n%s"]
  );
  if (!logOutput) return "No commit found";

  const commitInfo = parseGitLog(logOutput);
  if (!commitInfo) return "Failed to parse commit";

  // Check if already processed
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM git_commits WHERE project_id = ? AND commit_hash = ?`,
    [projectId, commitInfo.hash]
  );
  if (existing) return `Commit ${commitInfo.hash.slice(0, 7)} already processed`;

  // Get file changes
  const numstatOutput = await runGitCommand(
    "git", ["diff", "HEAD~1..HEAD", "--numstat"]
  );
  const files = numstatOutput ? parseNumstat(numstatOutput) : [];

  const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const filePaths = files.map((f) => f.path);

  // Link commit to active session (enables error-fix mapping and revert detection)
  let sessionId: number | null = null;
  try {
    const activeSession = await db.get<{ id: number }>(
      `SELECT id FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      [projectId]
    );
    sessionId = activeSession?.id ?? null;
  } catch {
    // sessions table might not have the right shape yet
  }

  // Store commit metadata
  await db.run(
    `INSERT OR IGNORE INTO git_commits (project_id, commit_hash, author, message, files_changed, insertions, deletions, committed_at, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      commitInfo.hash,
      commitInfo.author,
      commitInfo.message,
      JSON.stringify(filePaths),
      totalInsertions,
      totalDeletions,
      commitInfo.committedAt,
      sessionId,
    ]
  );

  // Update file metadata for each changed file
  for (const file of files) {
    await updateFileFromCommit(db, projectId, file);
  }

  // Update file correlations
  if (filePaths.length >= 2) {
    await updateFileCorrelations(db, projectId, filePaths);
  }

  // v4 Phase 2: Queue diff analysis for background processing
  try {
    await db.run(
      `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
      ["analyze_diffs", JSON.stringify({ projectId })]
    );
  } catch {
    // work_queue might not exist yet
  }

  // v4 Phase 4: Queue code intelligence jobs for changed files
  const codeFiles = filePaths.filter((f) =>
    /\.[jt]sx?$|\.mjs$/.test(f)
  );
  if (codeFiles.length > 0) {
    try {
      const projectPath = process.cwd();
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["reindex_symbols", JSON.stringify({ projectId, projectPath, filePaths: codeFiles })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["build_call_graph", JSON.stringify({ projectId, projectPath, filePaths: codeFiles })]
      );
    } catch {
      // work_queue might not exist yet
    }
  }

  // v4 Phase 5: Queue test run and revert detection
  try {
    const projectPath = process.cwd();
    await db.run(
      `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
      ["run_tests", JSON.stringify({ projectId, projectPath, commitHash: commitInfo.hash })]
    );
    await db.run(
      `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
      ["detect_reverts", JSON.stringify({ projectId })]
    );
    // v4 Phase 6: Refresh ownership after commits
    await db.run(
      `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
      ["refresh_ownership", JSON.stringify({ projectId })]
    );
  } catch {
    // work_queue might not exist yet
  }

  return `Processed commit ${commitInfo.hash.slice(0, 7)}: ${files.length} file(s), +${totalInsertions}/-${totalDeletions}`;
}

/**
 * Update a single file's metadata from a commit.
 */
async function updateFileFromCommit(
  db: DatabaseAdapter,
  projectId: number,
  change: FileChange
): Promise<void> {
  const existing = await db.get<{ id: number; change_count: number }>(
    `SELECT id, change_count FROM files WHERE project_id = ? AND path = ?`,
    [projectId, change.path]
  );

  if (existing) {
    const newCount = existing.change_count + 1;
    await db.run(
      `UPDATE files SET
        change_count = ?,
        temperature = 'hot',
        last_referenced_at = datetime('now'),
        velocity_score = CAST(? AS REAL) / (1 + (julianday('now') - julianday(COALESCE(first_changed_at, created_at)))),
        updated_at = datetime('now')
       WHERE id = ?`,
      [newCount, newCount, existing.id]
    );
  } else {
    // Auto-create file entry
    await db.run(
      `INSERT OR IGNORE INTO files (project_id, path, purpose, fragility, change_count, temperature, first_changed_at, created_at, updated_at)
       VALUES (?, ?, 'Auto-tracked from git', 3, 1, 'hot', datetime('now'), datetime('now'), datetime('now'))`,
      [projectId, change.path]
    );
  }
}

// ============================================================================
// Git Command Runner
// ============================================================================

async function runGitCommand(cmd: string, args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim() || null;
  } catch {
    return null;
  }
}
