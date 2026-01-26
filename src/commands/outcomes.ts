/**
 * Outcome Tracking
 * Track whether architectural decisions worked out over time.
 * Decisions are reviewed after N sessions to determine success/failure.
 */

import type { Database } from "bun:sqlite";
import type { OutcomeStatus } from "../types";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Record Outcome
// ============================================================================

export function recordOutcome(
  db: Database,
  projectId: number,
  decisionId: number,
  status: OutcomeStatus,
  notes?: string
): void {
  const decision = db
    .query<{ id: number; title: string; project_id: number }, [number, number]>(
      "SELECT id, title, project_id FROM decisions WHERE id = ? AND project_id = ?"
    )
    .get(decisionId, projectId);

  if (!decision) {
    throw new Error(`Decision #${decisionId} not found`);
  }

  db.run(
    `
    UPDATE decisions SET
      outcome_status = ?,
      outcome_notes = ?,
      outcome_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    [status, notes ?? null, decisionId]
  );
}

// ============================================================================
// Get Decisions Due for Review
// ============================================================================

export function getDecisionsDue(
  db: Database,
  projectId: number
): Array<{
  id: number;
  title: string;
  decision: string;
  sessions_since: number;
  check_after_sessions: number;
  decided_at: string;
}> {
  try {
    return db
      .query<
        {
          id: number;
          title: string;
          decision: string;
          sessions_since: number;
          check_after_sessions: number;
          decided_at: string;
        },
        [number]
      >(`
      SELECT id, title, decision, sessions_since, check_after_sessions, decided_at
      FROM decisions
      WHERE project_id = ?
        AND status = 'active'
        AND outcome_status = 'pending'
        AND sessions_since >= check_after_sessions
      ORDER BY sessions_since DESC
      LIMIT 10
    `)
      .all(projectId);
  } catch {
    return []; // Columns might not exist yet
  }
}

// ============================================================================
// Increment Sessions Since (called on session start)
// ============================================================================

export function incrementSessionsSince(db: Database, projectId: number): void {
  try {
    db.run(
      `
      UPDATE decisions SET sessions_since = sessions_since + 1
      WHERE project_id = ?
        AND status = 'active'
        AND outcome_status = 'pending'
    `,
      [projectId]
    );
  } catch {
    // Column might not exist yet
  }
}

// ============================================================================
// CLI Handler
// ============================================================================

export function handleOutcomeCommand(db: Database, projectId: number, args: string[]): void {
  const subCmd = args[0];

  switch (subCmd) {
    case "record":
    case "set": {
      const id = parseInt(args[1], 10);
      const status = args[2] as OutcomeStatus;
      const notes = args.slice(3).join(" ") || undefined;

      if (!id || !status || !["succeeded", "failed", "revised", "unknown"].includes(status)) {
        console.error("Usage: muninn outcome record <decision_id> <succeeded|failed|revised|unknown> [notes]");
        return;
      }

      recordOutcome(db, projectId, id, status, notes);
      console.error(`✅ Decision #${id} outcome recorded: ${status}`);
      outputSuccess({ id, status, notes });
      break;
    }

    case "due":
    case "review":
    case "list":
    case undefined: {
      const due = getDecisionsDue(db, projectId);

      if (due.length === 0) {
        console.error("No decisions due for review.");
        outputJson([]);
        return;
      }

      console.error(`\n📋 Decisions Due for Review (${due.length}):\n`);
      for (const d of due) {
        console.error(`  #${d.id}: ${d.title}`);
        console.error(`     ${d.decision.slice(0, 60)}...`);
        console.error(`     (${d.sessions_since} sessions since decided)`);
        console.error("");
      }
      outputJson(due);
      break;
    }

    default:
      console.error("Usage: muninn outcome <due|record> [args]");
  }
}

// ============================================================================
// Foundational Learnings
// ============================================================================

export interface FoundationalLearning {
  id: number;
  title: string;
  content: string;
  category: string;
  sessions_since_review: number;
  review_after_sessions: number;
  confidence: number;
  created_at: string;
}

/**
 * Get foundational learnings due for review
 */
export function getFoundationalLearningsDue(db: Database, projectId: number): FoundationalLearning[] {
  try {
    return db
      .query<FoundationalLearning, [number]>(`
        SELECT id, title, content, category, sessions_since_review, review_after_sessions, confidence, created_at
        FROM learnings
        WHERE project_id = ?
          AND foundational = 1
          AND review_status = 'pending'
          AND sessions_since_review >= review_after_sessions
        ORDER BY sessions_since_review DESC
        LIMIT 10
      `)
      .all(projectId);
  } catch {
    return []; // Columns might not exist yet
  }
}

/**
 * Increment sessions_since_review for all foundational learnings
 * Called on session start
 */
export function incrementFoundationalSessionsSince(db: Database, projectId: number): void {
  try {
    db.run(
      `
      UPDATE learnings
      SET sessions_since_review = sessions_since_review + 1
      WHERE project_id = ?
        AND foundational = 1
        AND review_status IN ('pending', 'confirmed', 'revised')
    `,
      [projectId]
    );
  } catch {
    // Columns might not exist yet
  }
}

/**
 * Confirm a foundational learning is still valid
 * Resets the review counter, increments confidence, and increments times_confirmed.
 * Auto-detects if learning is now ready for promotion.
 */
export function confirmFoundationalLearning(db: Database, projectId: number, id: number, _notes?: string): void {
  const learning = db
    .query<
      {
        id: number;
        project_id: number;
        confidence: number;
        foundational: number;
        times_applied: number;
        times_confirmed: number | null;
        promotion_status: string | null;
        archived_at: string | null;
      },
      [number, number]
    >(
      `SELECT id, project_id, confidence, foundational, times_applied,
              COALESCE(times_confirmed, 0) as times_confirmed,
              COALESCE(promotion_status, 'not_ready') as promotion_status,
              archived_at
       FROM learnings WHERE id = ? AND project_id = ?`
    )
    .get(id, projectId);

  if (!learning) {
    throw new Error(`Learning #${id} not found`);
  }

  // Update: increment confidence and times_confirmed
  db.run(
    `
    UPDATE learnings SET
      review_status = 'confirmed',
      sessions_since_review = 0,
      reviewed_at = CURRENT_TIMESTAMP,
      confidence = MIN(10, confidence + 1),
      times_confirmed = COALESCE(times_confirmed, 0) + 1
    WHERE id = ?
  `,
    [id]
  );

  // After confirming, switch back to pending for next review cycle
  db.run(
    `
    UPDATE learnings SET review_status = 'pending'
    WHERE id = ?
  `,
    [id]
  );

  // Auto-detect if now promotion-ready
  // Criteria: foundational=1, confidence>=8, times_confirmed>=3, times_applied>=5
  const newConfidence = Math.min(10, learning.confidence + 1);
  const newTimesConfirmed = (learning.times_confirmed ?? 0) + 1;

  if (
    learning.foundational === 1 &&
    newConfidence >= 8 &&
    newTimesConfirmed >= 3 &&
    learning.times_applied >= 5 &&
    learning.promotion_status === "not_ready" &&
    !learning.archived_at
  ) {
    try {
      db.run(`UPDATE learnings SET promotion_status = 'candidate' WHERE id = ?`, [id]);
      console.error(`\n💡 L${id} is now ready for CLAUDE.md promotion!`);
      console.error(`   Run \`muninn promote ${id} --to "## Section"\` to promote.\n`);
    } catch {
      // promotion_status column might not exist yet
    }
  }
}

/**
 * Revise a foundational learning with new content
 * Resets the review counter and times_confirmed (content changed, needs re-validation)
 */
export function reviseFoundationalLearning(
  db: Database,
  projectId: number,
  id: number,
  newContent: string,
  _notes?: string
): void {
  const learning = db
    .query<{ id: number; project_id: number }, [number, number]>(
      "SELECT id, project_id FROM learnings WHERE id = ? AND project_id = ?"
    )
    .get(id, projectId);

  if (!learning) {
    throw new Error(`Learning #${id} not found`);
  }

  db.run(
    `
    UPDATE learnings SET
      content = ?,
      review_status = 'revised',
      sessions_since_review = 0,
      reviewed_at = CURRENT_TIMESTAMP,
      times_confirmed = 0,
      promotion_status = CASE
        WHEN promotion_status = 'promoted' THEN 'demoted'
        ELSE 'not_ready'
      END
    WHERE id = ?
  `,
    [newContent, id]
  );

  // After revising, switch back to pending for next review cycle
  db.run(
    `
    UPDATE learnings SET review_status = 'pending'
    WHERE id = ?
  `,
    [id]
  );
}

/**
 * CLI handler for foundational learning commands
 */
export function handleFoundationalCommand(db: Database, projectId: number, args: string[]): void {
  const subCmd = args[0];

  switch (subCmd) {
    case "due":
    case "review":
    case "list":
    case undefined: {
      const due = getFoundationalLearningsDue(db, projectId);

      if (due.length === 0) {
        console.error("No foundational learnings due for review.");
        outputJson([]);
        return;
      }

      console.error(`\n📚 Foundational Learnings Due for Review (${due.length}):\n`);
      for (const l of due) {
        console.error(`  L${l.id}: ${l.title} [${l.category}]`);
        console.error(`     ${l.content.slice(0, 60)}...`);
        console.error(`     (${l.sessions_since_review} sessions since last review)`);
        console.error("");
      }
      outputJson(due);
      break;
    }

    case "confirm": {
      const id = parseInt(args[1], 10);
      const notes = args.slice(2).join(" ") || undefined;

      if (!id) {
        console.error("Usage: muninn foundational confirm <id> [notes]");
        return;
      }

      try {
        confirmFoundationalLearning(db, projectId, id, notes);
        console.error(`✅ Foundational learning L${id} confirmed (still valid)`);
        outputSuccess({ id, status: "confirmed", notes });
      } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }

    case "revise": {
      const id = parseInt(args[1], 10);
      const newContent = args.slice(2).join(" ");

      if (!id || !newContent) {
        console.error("Usage: muninn foundational revise <id> <new content>");
        return;
      }

      try {
        reviseFoundationalLearning(db, projectId, id, newContent);
        console.error(`✅ Foundational learning L${id} revised`);
        outputSuccess({ id, status: "revised", newContent });
      } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }

    default:
      console.error("Usage: muninn foundational <due|confirm|revise> [args]");
      console.error("");
      console.error("Commands:");
      console.error("  due              List foundational learnings due for review");
      console.error("  confirm <id>     Confirm learning is still valid (+1 confidence)");
      console.error("  revise <id> <content>  Update learning with new understanding");
  }
}
