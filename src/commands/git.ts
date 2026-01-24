/**
 * Git integration commands
 * Drift detection, conflict checking, git status integration
 */

import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { DriftResult, StaleFile } from "../types";
import { outputJson, computeContentHash } from "../utils/format";
import { logError } from "../utils/errors";

// ============================================================================
// Git Helpers
// ============================================================================

function isGitRepo(path: string): boolean {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function getGitStatus(path: string): string[] {
  try {
    const output = execSync("git status --porcelain", {
      cwd: path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => line.substring(3)); // Remove status prefix
  } catch {
    return [];
  }
}

// Note: getGitDiff function removed as unused, but available in git log if needed

function getUntrackedFiles(path: string): string[] {
  try {
    const output = execSync("git ls-files --others --exclude-standard", {
      cwd: path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function getRecentCommits(path: string, count: number = 5): Array<{ hash: string; message: string; date: string }> {
  try {
    const output = execSync(
      `git log --pretty=format:"%H|%s|%ai" -${count}`,
      {
        cwd: path,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [hash, message, date] = line.split("|");
        return { hash: hash.substring(0, 7), message, date };
      });
  } catch {
    return [];
  }
}

// ============================================================================
// Drift Detection Command
// ============================================================================

export function detectDrift(
  db: Database,
  projectId: number,
  projectPath: string
): DriftResult {
  const staleFiles: StaleFile[] = [];
  const gitChanges: string[] = [];
  const untrackedFiles: string[] = [];
  const recommendations: string[] = [];

  // Check if git repo
  const hasGit = isGitRepo(projectPath);

  if (hasGit) {
    // Get git changes
    const statusFiles = getGitStatus(projectPath);
    const untracked = getUntrackedFiles(projectPath);

    gitChanges.push(...statusFiles);
    untrackedFiles.push(...untracked.filter(f => !f.startsWith(".")));
  }

  // Get tracked files from database
  const trackedFiles = db.query<{
    path: string;
    content_hash: string | null;
    last_analyzed: string | null;
    fs_modified_at: string | null;
    fragility: number;
  }, [number]>(`
    SELECT path, content_hash, last_analyzed, fs_modified_at, fragility
    FROM files
    WHERE project_id = ? AND status = 'active'
  `).all(projectId);

  // Check each tracked file for staleness
  for (const file of trackedFiles) {
    const fullPath = join(projectPath, file.path);

    // Check if file exists
    if (!existsSync(fullPath)) {
      staleFiles.push({
        path: file.path,
        lastAnalyzed: file.last_analyzed || "never",
        fsModified: "deleted",
        status: "missing",
        reason: "File no longer exists on disk",
      });
      continue;
    }

    // Check content hash
    if (file.content_hash) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const currentHash = computeContentHash(content);

        if (currentHash !== file.content_hash) {
          const stat = statSync(fullPath);
          staleFiles.push({
            path: file.path,
            lastAnalyzed: file.last_analyzed || "never",
            fsModified: stat.mtime.toISOString(),
            status: "stale",
            reason: "Content changed since last analysis",
          });
        }
      } catch (error) {
        logError("detectDrift:readFile", error);
      }
    } else if (file.fs_modified_at) {
      // Fall back to mtime comparison
      try {
        const stat = statSync(fullPath);
        const currentMtime = stat.mtime.toISOString();
        if (currentMtime !== file.fs_modified_at) {
          staleFiles.push({
            path: file.path,
            lastAnalyzed: file.last_analyzed || "never",
            fsModified: currentMtime,
            status: "stale",
            reason: "File modified since last analysis",
          });
        }
      } catch {
        // Skip
      }
    }
  }

  // Generate recommendations
  if (staleFiles.length > 0) {
    const criticalStale = staleFiles.filter(f => {
      const record = trackedFiles.find(t => t.path === f.path);
      return record && record.fragility >= 7;
    });

    if (criticalStale.length > 0) {
      recommendations.push(`URGENT: ${criticalStale.length} fragile file(s) have stale knowledge. Run \`muninn analyze\` or update individually.`);
    }

    if (staleFiles.length > 5) {
      recommendations.push(`Consider running \`muninn analyze\` to refresh knowledge for all ${staleFiles.length} stale files.`);
    } else {
      recommendations.push(`Update knowledge for: ${staleFiles.map(f => f.path).join(", ")}`);
    }
  }

  if (untrackedFiles.length > 0) {
    const codeFiles = untrackedFiles.filter(f =>
      f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx")
    );
    if (codeFiles.length > 0) {
      recommendations.push(`${codeFiles.length} new code file(s) not tracked. Consider adding them with \`muninn file add\`.`);
    }
  }

  if (gitChanges.length > 0 && staleFiles.length === 0) {
    recommendations.push("Git changes detected but knowledge is up to date. Good job!");
  }

  if (staleFiles.length === 0 && untrackedFiles.length === 0) {
    recommendations.push("No drift detected. Knowledge is current.");
  }

  const result: DriftResult = {
    staleFiles,
    gitChanges,
    untrackedFiles,
    recommendations,
  };

  displayDriftResult(result, hasGit);
  outputJson(result);
  return result;
}

function displayDriftResult(result: DriftResult, hasGit: boolean): void {
  console.error("\n🔄 Knowledge Drift Detection:\n");

  if (!hasGit) {
    console.error("⚠️  Not a git repository. Git integration disabled.\n");
  }

  // Stale files
  if (result.staleFiles.length > 0) {
    console.error(`📁 Stale Files (${result.staleFiles.length}):`);
    for (const file of result.staleFiles.slice(0, 10)) {
      const statusIcon = file.status === "missing" ? "❌" : "⚠️";
      console.error(`   ${statusIcon} ${file.path}`);
      console.error(`      ${file.reason}`);
      console.error(`      Last analyzed: ${file.lastAnalyzed}`);
    }
    if (result.staleFiles.length > 10) {
      console.error(`   ... and ${result.staleFiles.length - 10} more`);
    }
    console.error("");
  }

  // Git changes
  if (result.gitChanges.length > 0) {
    console.error(`📝 Git Changes (${result.gitChanges.length}):`);
    for (const file of result.gitChanges.slice(0, 10)) {
      console.error(`   - ${file}`);
    }
    if (result.gitChanges.length > 10) {
      console.error(`   ... and ${result.gitChanges.length - 10} more`);
    }
    console.error("");
  }

  // Untracked files
  if (result.untrackedFiles.length > 0) {
    console.error(`📂 Untracked Files (${result.untrackedFiles.length}):`);
    for (const file of result.untrackedFiles.slice(0, 5)) {
      console.error(`   - ${file}`);
    }
    if (result.untrackedFiles.length > 5) {
      console.error(`   ... and ${result.untrackedFiles.length - 5} more`);
    }
    console.error("");
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    console.error("💡 Recommendations:");
    for (const rec of result.recommendations) {
      console.error(`   - ${rec}`);
    }
    console.error("");
  }
}

// ============================================================================
// Git Info Command
// ============================================================================

export function getGitInfo(projectPath: string): {
  isGit: boolean;
  branch?: string;
  recentCommits?: Array<{ hash: string; message: string; date: string }>;
  status?: string[];
  untracked?: string[];
} {
  if (!isGitRepo(projectPath)) {
    return { isGit: false };
  }

  let branch: string | undefined;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    // Ignore
  }

  return {
    isGit: true,
    branch,
    recentCommits: getRecentCommits(projectPath),
    status: getGitStatus(projectPath),
    untracked: getUntrackedFiles(projectPath).slice(0, 20),
  };
}

// ============================================================================
// Update Last Queried At
// ============================================================================

export function updateLastQueried(
  db: Database,
  projectId: number,
  paths: string[]
): void {
  const stmt = db.prepare(`
    UPDATE files
    SET last_queried_at = CURRENT_TIMESTAMP
    WHERE project_id = ? AND path = ?
  `);

  for (const path of paths) {
    stmt.run(projectId, path);
  }
}

// ============================================================================
// Sync File Hashes
// ============================================================================

export function syncFileHashes(
  db: Database,
  projectId: number,
  projectPath: string
): { updated: number; missing: number } {
  let updated = 0;
  let missing = 0;

  const files = db.query<{ id: number; path: string }, [number]>(`
    SELECT id, path FROM files WHERE project_id = ? AND status = 'active'
  `).all(projectId);

  for (const file of files) {
    const fullPath = join(projectPath, file.path);

    if (!existsSync(fullPath)) {
      missing++;
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const hash = computeContentHash(content);
      const stat = statSync(fullPath);

      db.run(`
        UPDATE files
        SET content_hash = ?, fs_modified_at = ?
        WHERE id = ?
      `, [hash, stat.mtime.toISOString(), file.id]);

      updated++;
    } catch {
      // Skip unreadable files
    }
  }

  console.error(`✅ Synced ${updated} file hashes (${missing} missing files)`);
  return { updated, missing };
}
