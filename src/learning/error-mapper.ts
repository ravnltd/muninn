/**
 * Error-Fix Mapper — Link errors to their fixes
 *
 * Watches temporal patterns: error_event -> successful fix in same session.
 * When a git commit follows an error within 30 min and touches the affected
 * file, links as a fix. Normalizes error signatures for future recall.
 *
 * Next occurrence of the same signature -> surface the previous fix.
 *
 * Runs in cold path only (background worker or session end).
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

interface ErrorFixPair {
  errorSignature: string;
  errorType: string;
  errorExample: string;
  fixCommitHash: string | null;
  fixDescription: string;
  fixFiles: string[];
  confidence: number;
}

interface RecentError {
  id: number;
  error_type: string;
  error_message: string;
  error_signature: string;
  source_file: string | null;
  created_at: string;
}

interface RecentCommit {
  commit_hash: string;
  message: string;
  files_changed: string | null;
  committed_at: string;
}

// ============================================================================
// Error-Fix Detection
// ============================================================================

/**
 * Scan for error-fix pairs in the current session.
 * Looks for: error_event followed by git_commit within 30 min that touches affected file.
 */
export async function detectErrorFixPairs(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<ErrorFixPair[]> {
  // Get errors from this session
  const errors = await db.all<RecentError>(
    `SELECT id, error_type, error_message, error_signature, source_file, created_at
     FROM error_events
     WHERE project_id = ? AND session_id = ?
     ORDER BY created_at ASC`,
    [projectId, sessionId]
  );

  if (errors.length === 0) return [];

  // Get commits that happened during or shortly after this session
  const commits = await db.all<RecentCommit>(
    `SELECT commit_hash, message, files_changed, committed_at
     FROM git_commits
     WHERE project_id = ?
     AND (session_id = ? OR committed_at >= (SELECT MIN(created_at) FROM error_events WHERE session_id = ?))
     ORDER BY committed_at ASC`,
    [projectId, sessionId, sessionId]
  );

  const pairs: ErrorFixPair[] = [];

  for (const error of errors) {
    // Find a commit that:
    // 1. Happened within 30 min after the error
    // 2. Touches the affected file (if known)
    const errorTime = new Date(error.created_at).getTime();

    for (const commit of commits) {
      const commitTime = new Date(commit.committed_at).getTime();
      const timeDiffMin = (commitTime - errorTime) / 60000;

      // Must be after the error and within 30 min
      if (timeDiffMin < 0 || timeDiffMin > 30) continue;

      // Check if commit touches the affected file
      const commitFiles = commit.files_changed ? JSON.parse(commit.files_changed) as string[] : [];
      const touchesAffected = !error.source_file || commitFiles.some((f) =>
        f === error.source_file || error.source_file?.includes(f) || f.includes(error.source_file || "")
      );

      if (!touchesAffected && commitFiles.length > 0) continue;

      // Found a likely fix
      const confidence = calculateFixConfidence(error, commit, timeDiffMin);

      pairs.push({
        errorSignature: error.error_signature,
        errorType: error.error_type,
        errorExample: error.error_message.slice(0, 500),
        fixCommitHash: commit.commit_hash,
        fixDescription: commit.message.split("\n")[0].slice(0, 200),
        fixFiles: commitFiles.slice(0, 10),
        confidence,
      });

      break; // One fix per error
    }
  }

  return pairs;
}

/** Calculate confidence that a commit is the fix for an error */
function calculateFixConfidence(
  error: RecentError,
  commit: RecentCommit,
  timeDiffMin: number
): number {
  let confidence = 0.5;

  // Closer in time = higher confidence
  if (timeDiffMin < 5) confidence += 0.2;
  else if (timeDiffMin < 15) confidence += 0.1;

  // Commit message mentions "fix" = higher confidence
  if (/\bfix\b/i.test(commit.message)) confidence += 0.15;

  // Source file is in commit files = higher confidence
  if (error.source_file) {
    const files = commit.files_changed ? JSON.parse(commit.files_changed) as string[] : [];
    if (files.includes(error.source_file)) confidence += 0.15;
  }

  return Math.min(0.95, confidence);
}

// ============================================================================
// Storage
// ============================================================================

/**
 * Persist error-fix pairs to the database.
 * Upserts: if the same signature exists, increments times_seen/times_fixed.
 */
export async function storeErrorFixPairs(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
  pairs: ErrorFixPair[]
): Promise<number> {
  let stored = 0;

  for (const pair of pairs) {
    try {
      await db.run(
        `INSERT INTO error_fix_pairs (project_id, error_signature, error_type, error_example, fix_commit_hash, fix_description, fix_files, session_id, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, error_signature) DO UPDATE SET
           times_seen = times_seen + 1,
           times_fixed = times_fixed + 1,
           fix_commit_hash = excluded.fix_commit_hash,
           fix_description = excluded.fix_description,
           fix_files = excluded.fix_files,
           confidence = MIN(0.95, confidence + 0.1),
           last_seen_at = datetime('now')`,
        [
          projectId,
          pair.errorSignature,
          pair.errorType,
          pair.errorExample,
          pair.fixCommitHash,
          pair.fixDescription,
          JSON.stringify(pair.fixFiles),
          sessionId,
          pair.confidence,
        ]
      );
      stored++;
    } catch {
      // Swallow — best effort
    }
  }

  return stored;
}

// ============================================================================
// Recall
// ============================================================================

/**
 * Look up known fixes for an error signature.
 * Used by Phase 3's context engine to surface fixes when errors recur.
 */
export async function lookupFix(
  db: DatabaseAdapter,
  projectId: number,
  errorSignature: string
): Promise<ErrorFixPair | null> {
  const result = await db.get<{
    error_signature: string;
    error_type: string;
    error_example: string;
    fix_commit_hash: string | null;
    fix_description: string;
    fix_files: string;
    confidence: number;
    times_fixed: number;
  }>(
    `SELECT error_signature, error_type, error_example, fix_commit_hash, fix_description, fix_files, confidence, times_fixed
     FROM error_fix_pairs
     WHERE project_id = ? AND error_signature = ? AND confidence >= 0.4
     ORDER BY confidence DESC
     LIMIT 1`,
    [projectId, errorSignature]
  );

  if (!result) return null;

  return {
    errorSignature: result.error_signature,
    errorType: result.error_type,
    errorExample: result.error_example,
    fixCommitHash: result.fix_commit_hash,
    fixDescription: result.fix_description,
    fixFiles: JSON.parse(result.fix_files || "[]") as string[],
    confidence: result.confidence,
  };
}

/**
 * Process all unmapped errors from a session and link to fixes.
 * Entry point for session-end processing.
 */
export async function processSessionErrors(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number
): Promise<number> {
  const pairs = await detectErrorFixPairs(db, projectId, sessionId);
  if (pairs.length === 0) return 0;
  return storeErrorFixPairs(db, projectId, sessionId, pairs);
}
