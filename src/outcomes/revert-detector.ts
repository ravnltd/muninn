/**
 * Revert Detector — Detect git reverts and link to original sessions
 *
 * Watches git_commits for revert patterns:
 * 1. Commit message contains "revert" + references original hash
 * 2. Commit message matches "Revert \"<original message>\""
 *
 * When detected:
 * - Links to original session
 * - Reduces confidence on learnings from that session (x0.7)
 * - Flags decisions from that session for review
 *
 * Runs in background worker — never blocks MCP tool calls.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export type RevertType = "message" | "hash_reference" | "inverse_diff";

export interface RevertEvent {
  revertCommitHash: string;
  originalCommitHash: string | null;
  originalSessionId: number | null;
  revertType: RevertType;
  filesAffected: string[];
}

// ============================================================================
// Detection
// ============================================================================

/**
 * Scan recent commits for revert patterns.
 * Checks unprocessed commits in git_commits table.
 */
export async function detectReverts(
  db: DatabaseAdapter,
  projectId: number
): Promise<RevertEvent[]> {
  const events: RevertEvent[] = [];

  // Get recent commits not yet checked for reverts
  const commits = await db.all<{
    commit_hash: string;
    message: string;
    files_changed: string | null;
  }>(
    `SELECT gc.commit_hash, gc.message, gc.files_changed
     FROM git_commits gc
     LEFT JOIN revert_events re ON gc.commit_hash = re.revert_commit_hash AND re.project_id = gc.project_id
     WHERE gc.project_id = ? AND re.id IS NULL
     ORDER BY gc.committed_at DESC
     LIMIT 20`,
    [projectId]
  );

  for (const commit of commits) {
    const revert = detectRevertInCommit(commit.message);
    if (!revert) continue;

    // Try to find the original commit
    let originalCommitHash: string | null = revert.originalHash;
    let originalSessionId: number | null = null;

    if (originalCommitHash) {
      // Look up session from the original commit
      const original = await db.get<{ session_id: number | null }>(
        `SELECT session_id FROM git_commits WHERE project_id = ? AND commit_hash LIKE ?`,
        [projectId, `${originalCommitHash}%`]
      );
      originalSessionId = original?.session_id || null;
    } else if (revert.originalMessage) {
      // Find by message match
      const original = await db.get<{ commit_hash: string; session_id: number | null }>(
        `SELECT commit_hash, session_id FROM git_commits
         WHERE project_id = ? AND message LIKE ?
         ORDER BY committed_at DESC LIMIT 1`,
        [projectId, `%${revert.originalMessage}%`]
      );
      if (original) {
        originalCommitHash = original.commit_hash;
        originalSessionId = original.session_id || null;
      }
    }

    const filesAffected = commit.files_changed
      ? (JSON.parse(commit.files_changed) as string[])
      : [];

    events.push({
      revertCommitHash: commit.commit_hash,
      originalCommitHash,
      originalSessionId,
      revertType: revert.type,
      filesAffected,
    });
  }

  return events;
}

/** Detect revert patterns in a commit message */
function detectRevertInCommit(message: string): {
  type: RevertType;
  originalHash: string | null;
  originalMessage: string | null;
} | null {
  const lower = message.toLowerCase();

  // Pattern 1: 'Revert "original message"'
  const revertQuoteMatch = message.match(/^Revert\s+"([^"]+)"/i);
  if (revertQuoteMatch) {
    return {
      type: "message",
      originalHash: null,
      originalMessage: revertQuoteMatch[1],
    };
  }

  // Pattern 2: 'revert <hash>' or 'reverts <hash>'
  const hashMatch = lower.match(/\breverts?\s+([0-9a-f]{7,40})\b/);
  if (hashMatch) {
    return {
      type: "hash_reference",
      originalHash: hashMatch[1],
      originalMessage: null,
    };
  }

  // Pattern 3: Message starts with "revert:" or "revert -"
  if (/^revert[:\s-]/i.test(message)) {
    const rest = message.replace(/^revert[:\s-]+/i, "").trim();
    return {
      type: "message",
      originalHash: null,
      originalMessage: rest || null,
    };
  }

  return null;
}

// ============================================================================
// Impact Processing
// ============================================================================

/**
 * Process a revert event: reduce confidence on associated learnings,
 * flag decisions for review.
 */
export async function processRevertImpact(
  db: DatabaseAdapter,
  projectId: number,
  event: RevertEvent
): Promise<void> {
  if (!event.originalSessionId) return;

  // Reduce confidence on learnings from the original session
  try {
    await db.run(
      `UPDATE learnings SET
        confidence = MAX(1, confidence * 0.7),
        temperature = 'cold'
       WHERE project_id = ? AND id IN (
         SELECT learning_id FROM session_learnings WHERE session_id = ?
       )`,
      [projectId, event.originalSessionId]
    );
  } catch {
    // session_learnings or temperature column might not exist
  }

  // Flag decisions from the original session for review
  try {
    // Find decisions whose affected files overlap with reverted files
    if (event.filesAffected.length > 0) {
      const decisions = await db.all<{ id: number; affects: string | null }>(
        `SELECT id, affects FROM decisions
         WHERE project_id = ? AND status = 'active' AND outcome_status = 'pending'`,
        [projectId]
      );

      for (const decision of decisions) {
        const affects = decision.affects
          ? (JSON.parse(decision.affects) as string[])
          : [];
        const overlap = affects.some((f) => event.filesAffected.includes(f));
        if (overlap) {
          await db.run(
            `UPDATE decisions SET outcome_status = 'needs_review' WHERE id = ?`,
            [decision.id]
          );
        }
      }
    }
  } catch {
    // Column or table might not exist
  }
}

// ============================================================================
// Persistence
// ============================================================================

/** Store revert event in the database */
export async function storeRevertEvent(
  db: DatabaseAdapter,
  projectId: number,
  event: RevertEvent
): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO revert_events (project_id, revert_commit_hash, original_commit_hash, original_session_id, revert_type, files_affected, processed)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [
      projectId,
      event.revertCommitHash,
      event.originalCommitHash,
      event.originalSessionId,
      event.revertType,
      JSON.stringify(event.filesAffected),
    ]
  );
}

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Detect and process all pending reverts.
 * Called from background worker after commit processing.
 */
export async function processReverts(
  db: DatabaseAdapter,
  projectId: number
): Promise<number> {
  const events = await detectReverts(db, projectId);
  let processed = 0;

  for (const event of events) {
    await processRevertImpact(db, projectId, event);
    await storeRevertEvent(db, projectId, event);
    processed++;
  }

  return processed;
}
