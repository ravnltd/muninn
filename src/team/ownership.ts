/**
 * Code Ownership Tracker — Git-based file ownership
 *
 * Parses git shortlog to determine primary author per file.
 * When editing a file you dont own: surfaces owners decisions and learnings.
 *
 * Runs in background worker — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface FileOwnership {
  filePath: string;
  primaryAuthor: string;
  commitCount: number;
  lastCommitAt: string | null;
}

// ============================================================================
// Git Analysis
// ============================================================================

/**
 * Get file ownership from git shortlog for a specific file.
 */
async function getGitOwnership(filePath: string): Promise<{
  author: string;
  commits: number;
} | null> {
  try {
    const proc = Bun.spawn(
      ["git", "shortlog", "-sn", "--no-merges", "HEAD", "--", filePath],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const lines = output.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    // First line is the top contributor
    const match = lines[0].match(/^\s*(\d+)\s+(.+)$/);
    if (!match) return null;

    return {
      commits: parseInt(match[1], 10),
      author: match[2].trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Batch git shortlog for the whole project.
 * More efficient than per-file analysis.
 */
async function getProjectOwnership(): Promise<Map<string, { author: string; commits: number }>> {
  const ownership = new Map<string, { author: string; commits: number }>();

  try {
    // Get all files with their top committer via git log
    const proc = Bun.spawn(
      ["git", "log", "--format=%an", "--name-only", "--no-merges", "-n", "500"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const lines = output.trim().split("\n");
    let currentAuthor = "";
    const fileCounts = new Map<string, Map<string, number>>();

    for (const line of lines) {
      if (line === "") continue;

      // Author lines don't contain path separators
      if (!line.includes("/") && !line.includes(".")) {
        currentAuthor = line.trim();
        continue;
      }

      if (currentAuthor && line.trim()) {
        const file = line.trim();
        if (!fileCounts.has(file)) {
          fileCounts.set(file, new Map());
        }
        const authors = fileCounts.get(file) as Map<string, number>;
        authors.set(currentAuthor, (authors.get(currentAuthor) || 0) + 1);
      }
    }

    // Determine primary author per file
    for (const [file, authors] of fileCounts) {
      let topAuthor = "";
      let topCount = 0;
      for (const [author, count] of authors) {
        if (count > topCount) {
          topAuthor = author;
          topCount = count;
        }
      }
      if (topAuthor) {
        ownership.set(file, { author: topAuthor, commits: topCount });
      }
    }
  } catch {
    // Git might not be available
  }

  return ownership;
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Refresh ownership data for the entire project.
 */
export async function refreshOwnership(
  db: DatabaseAdapter,
  projectId: number
): Promise<{ updated: number }> {
  const ownership = await getProjectOwnership();
  let updated = 0;

  for (const [filePath, info] of ownership) {
    try {
      await db.run(
        `INSERT INTO code_ownership (project_id, file_path, primary_author, commit_count, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_id, file_path) DO UPDATE SET
           primary_author = excluded.primary_author,
           commit_count = excluded.commit_count,
           updated_at = datetime('now')`,
        [projectId, filePath, info.author, info.commits]
      );
      updated++;
    } catch {
      // Skip files that fail
    }
  }

  return { updated };
}

/**
 * Get ownership for a specific file.
 */
export async function getFileOwnership(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<FileOwnership | null> {
  try {
    // Try DB first
    const cached = await db.get<{
      file_path: string;
      primary_author: string;
      commit_count: number;
      last_commit_at: string | null;
    }>(
      `SELECT file_path, primary_author, commit_count, last_commit_at
       FROM code_ownership
       WHERE project_id = ? AND file_path = ?`,
      [projectId, filePath]
    );

    if (cached) {
      return {
        filePath: cached.file_path,
        primaryAuthor: cached.primary_author,
        commitCount: cached.commit_count,
        lastCommitAt: cached.last_commit_at,
      };
    }

    // Fall back to live git query
    const live = await getGitOwnership(filePath);
    if (!live) return null;

    // Cache it
    await db.run(
      `INSERT OR REPLACE INTO code_ownership (project_id, file_path, primary_author, commit_count)
       VALUES (?, ?, ?, ?)`,
      [projectId, filePath, live.author, live.commits]
    );

    return {
      filePath,
      primaryAuthor: live.author,
      commitCount: live.commits,
      lastCommitAt: null,
    };
  } catch {
    return null;
  }
}

/**
 * Get owners decisions and learnings for context when editing their files.
 */
export async function getOwnerContext(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<{ owner: string; decisions: string[]; learnings: string[] } | null> {
  const ownership = await getFileOwnership(db, projectId, filePath);
  if (!ownership) return null;

  const decisions: string[] = [];
  const learnings: string[] = [];

  try {
    // Find decisions affecting this file
    const relatedDecisions = await db.all<{ title: string; decision: string }>(
      `SELECT title, decision FROM decisions
       WHERE project_id = ? AND status = 'active' AND affects LIKE ?
       ORDER BY decided_at DESC LIMIT 3`,
      [projectId, `%${filePath}%`]
    );
    for (const d of relatedDecisions) {
      decisions.push(`${d.title}: ${d.decision.slice(0, 100)}`);
    }

    // Find learnings related to this file area
    const pathParts = filePath.split("/");
    const dirPattern = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : filePath;
    const relatedLearnings = await db.all<{ title: string; content: string }>(
      `SELECT title, content FROM learnings
       WHERE project_id = ? AND confidence >= 5 AND (context LIKE ? OR files LIKE ?)
       ORDER BY confidence DESC LIMIT 3`,
      [projectId, `%${dirPattern}%`, `%${filePath}%`]
    );
    for (const l of relatedLearnings) {
      learnings.push(`${l.title}: ${l.content.slice(0, 100)}`);
    }
  } catch {
    // Tables might not have expected columns
  }

  return {
    owner: ownership.primaryAuthor,
    decisions,
    learnings,
  };
}
