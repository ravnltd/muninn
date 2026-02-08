/**
 * Outcome Tracking
 * Track whether architectural decisions worked out over time.
 * Decisions are reviewed after N sessions to determine success/failure.
 *
 * Also handles the learning-decision feedback loop:
 * - Successful decisions reinforce their contributing learnings
 * - Failed decisions reduce confidence of contributing learnings
 * - Revised decisions flag learnings for review
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { OutcomeStatus } from "../types";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Record Outcome
// ============================================================================

export async function recordOutcome(
  db: DatabaseAdapter,
  projectId: number,
  decisionId: number,
  status: OutcomeStatus,
  notes?: string
): Promise<void> {
  const decision = await db.get<{ id: number; title: string; project_id: number }>(
    "SELECT id, title, project_id FROM decisions WHERE id = ? AND project_id = ?",
    [decisionId, projectId]
  );

  if (!decision) {
    throw new Error(`Decision #${decisionId} not found`);
  }

  await db.run(
    `
    UPDATE decisions SET
      outcome_status = ?,
      outcome_notes = ?,
      outcome_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    [status, notes ?? null, decisionId]
  );

  // Adaptive review cadence: adjust interval based on outcome
  if (status === "succeeded") {
    await db.run(
      `UPDATE decisions SET check_after_sessions = MIN(100, check_after_sessions * 2), sessions_since = 0 WHERE id = ?`,
      [decisionId]
    );
  } else if (status === "failed") {
    await db.run(
      `UPDATE decisions SET check_after_sessions = MAX(3, check_after_sessions / 2), sessions_since = 0 WHERE id = ?`,
      [decisionId]
    );
  } else if (status === "revised") {
    await db.run(
      `UPDATE decisions SET check_after_sessions = 5, sessions_since = 0 WHERE id = ?`,
      [decisionId]
    );
  }

  // Handle the learning-decision feedback loop
  await processLearningFeedback(db, decisionId, status);
}

// ============================================================================
// Learning-Decision Feedback Loop
// ============================================================================

interface LinkedLearning {
  learning_id: number;
  contribution: string;
  title: string;
  confidence: number;
}

/**
 * Process feedback to learnings based on decision outcome.
 * - succeeded: Reinforce linked learnings (boost confidence, reset decay)
 * - failed: Reduce confidence of linked learnings
 * - revised: Flag linked learnings for review
 */
async function processLearningFeedback(
  db: DatabaseAdapter,
  decisionId: number,
  outcome: OutcomeStatus
): Promise<void> {
  try {
    // Get learnings linked to this decision
    const linkedLearnings = await db.all<LinkedLearning>(
      `SELECT dl.learning_id, dl.contribution, l.title, l.confidence
       FROM decision_learnings dl
       JOIN learnings l ON dl.learning_id = l.id
       WHERE dl.decision_id = ?`,
      [decisionId]
    );

    if (linkedLearnings.length === 0) return;

    for (const link of linkedLearnings) {
      switch (outcome) {
        case "succeeded":
          // Reinforce: boost confidence and reset decay timer
          if (link.contribution === "influenced") {
            await reinforceLearning(db, link.learning_id);
            console.error(`  ✅ Reinforced learning L${link.learning_id}: ${link.title}`);
          }
          break;

        case "failed":
          // Reduce confidence for learnings that influenced the failed decision
          if (link.contribution === "influenced") {
            await reduceLearningConfidence(db, link.learning_id);
            console.error(`  ⚠️ Reduced confidence for L${link.learning_id}: ${link.title}`);
          }
          break;

        case "revised":
          // Flag learnings for review - they may need updating
          if (link.contribution === "influenced") {
            await flagLearningForReview(db, link.learning_id);
            console.error(`  📝 Flagged L${link.learning_id} for review: ${link.title}`);
          }
          break;
      }
    }
  } catch {
    // Table might not exist yet, silently ignore
  }
}

/**
 * Reinforce a learning: boost confidence and reset decay timer
 */
export async function reinforceLearning(db: DatabaseAdapter, learningId: number): Promise<void> {
  try {
    // First, save current state as a version
    await saveLearningVersion(db, learningId, "reinforcement");

    // Update the learning
    await db.run(
      `UPDATE learnings SET
        confidence = MIN(10, confidence + 0.5),
        last_reinforced_at = CURRENT_TIMESTAMP,
        times_applied = times_applied + 1,
        last_applied = CURRENT_TIMESTAMP,
        temperature = 'warm'
       WHERE id = ?`,
      [learningId]
    );
  } catch {
    // Columns might not exist, try simpler update
    await db.run(
      `UPDATE learnings SET
        confidence = MIN(10, confidence + 0.5),
        times_applied = times_applied + 1,
        last_applied = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [learningId]
    );
  }
}

/**
 * Reduce confidence for a learning that contributed to a failed decision
 */
async function reduceLearningConfidence(db: DatabaseAdapter, learningId: number): Promise<void> {
  try {
    // Save current state as a version
    await saveLearningVersion(db, learningId, "failed_decision");

    // Reduce confidence but don't go below 1
    await db.run(
      `UPDATE learnings SET
        confidence = MAX(1, confidence - 1),
        temperature = 'cold'
       WHERE id = ?`,
      [learningId]
    );
  } catch {
    await db.run(
      `UPDATE learnings SET confidence = MAX(1, confidence - 1) WHERE id = ?`,
      [learningId]
    );
  }
}

/**
 * Flag a learning for review (after a decision was revised)
 */
async function flagLearningForReview(db: DatabaseAdapter, learningId: number): Promise<void> {
  try {
    await db.run(
      `UPDATE learnings SET
        review_status = 'pending',
        sessions_since_review = COALESCE(review_after_sessions, 0)
       WHERE id = ?`,
      [learningId]
    );
  } catch {
    // Review columns might not exist, silently ignore
  }
}

/**
 * Save a version of a learning before modifying it
 */
async function saveLearningVersion(
  db: DatabaseAdapter,
  learningId: number,
  reason: string
): Promise<void> {
  try {
    // Get current learning state
    const learning = await db.get<{ content: string; confidence: number }>(
      "SELECT content, confidence FROM learnings WHERE id = ?",
      [learningId]
    );

    if (!learning) return;

    // Get next version number
    const lastVersion = await db.get<{ version: number }>(
      "SELECT MAX(version) as version FROM learning_versions WHERE learning_id = ?",
      [learningId]
    );

    const nextVersion = (lastVersion?.version ?? 0) + 1;

    // Insert version
    await db.run(
      `INSERT INTO learning_versions (learning_id, version, content, confidence, change_reason)
       VALUES (?, ?, ?, ?, ?)`,
      [learningId, nextVersion, learning.content, learning.confidence, reason]
    );
  } catch {
    // Version table might not exist, silently ignore
  }
}

// ============================================================================
// Get Decisions Due for Review
// ============================================================================

export async function getDecisionsDue(
  db: DatabaseAdapter,
  projectId: number
): Promise<Array<{
  id: number;
  title: string;
  decision: string;
  sessions_since: number;
  check_after_sessions: number;
  decided_at: string;
}>> {
  try {
    return await db.all<{
      id: number;
      title: string;
      decision: string;
      sessions_since: number;
      check_after_sessions: number;
      decided_at: string;
    }>(`
      SELECT id, title, decision, sessions_since, check_after_sessions, decided_at
      FROM decisions
      WHERE project_id = ?
        AND status = 'active'
        AND outcome_status = 'pending'
        AND sessions_since >= check_after_sessions
      ORDER BY sessions_since DESC
      LIMIT 10
    `, [projectId]);
  } catch {
    return []; // Columns might not exist yet
  }
}

// ============================================================================
// Increment Sessions Since (called on session start)
// ============================================================================

export async function incrementSessionsSince(db: DatabaseAdapter, projectId: number): Promise<void> {
  try {
    await db.run(
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

export async function handleOutcomeCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
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

      await recordOutcome(db, projectId, id, status, notes);
      console.error(`✅ Decision #${id} outcome recorded: ${status}`);
      outputSuccess({ id, status, notes });
      break;
    }

    case "due":
    case "review":
    case "list":
    case undefined: {
      const due = await getDecisionsDue(db, projectId);

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

    case "batch": {
      // Format: muninn outcome batch 21:succeeded 22:succeeded 29:failed
      const entries = args.slice(1);
      if (entries.length === 0) {
        console.error("Usage: muninn outcome batch <id:status> [id:status ...]");
        return;
      }

      const results: Array<{ id: number; status: string; error?: string }> = [];
      for (const entry of entries) {
        const [idStr, status] = entry.split(":");
        const id = parseInt(idStr, 10);
        if (!id || !status || !["succeeded", "failed", "revised", "unknown"].includes(status)) {
          results.push({ id: id || 0, status: "error", error: `Invalid entry: ${entry}` });
          continue;
        }
        try {
          await recordOutcome(db, projectId, id, status as OutcomeStatus);
          results.push({ id, status });
        } catch (error) {
          results.push({ id, status: "error", error: error instanceof Error ? error.message : String(error) });
        }
      }

      const ok = results.filter((r) => r.status !== "error").length;
      const failed = results.length - ok;
      console.error(`Batch: ${ok} recorded${failed > 0 ? `, ${failed} failed` : ""}`);
      outputJson(results);
      break;
    }

    default:
      console.error("Usage: muninn outcome <due|record|batch> [args]");
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
export async function getFoundationalLearningsDue(db: DatabaseAdapter, projectId: number): Promise<FoundationalLearning[]> {
  try {
    return await db.all<FoundationalLearning>(`
        SELECT id, title, content, category, sessions_since_review, review_after_sessions, confidence, created_at
        FROM learnings
        WHERE project_id = ?
          AND foundational = 1
          AND review_status = 'pending'
          AND sessions_since_review >= review_after_sessions
        ORDER BY sessions_since_review DESC
        LIMIT 10
      `, [projectId]);
  } catch {
    return []; // Columns might not exist yet
  }
}

/**
 * Increment sessions_since_review for all foundational learnings
 * Called on session start
 */
export async function incrementFoundationalSessionsSince(db: DatabaseAdapter, projectId: number): Promise<void> {
  try {
    await db.run(
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
export async function confirmFoundationalLearning(db: DatabaseAdapter, projectId: number, id: number, _notes?: string): Promise<void> {
  const learning = await db.get<{
    id: number;
    project_id: number;
    confidence: number;
    foundational: number;
    times_applied: number;
    times_confirmed: number | null;
    promotion_status: string | null;
    archived_at: string | null;
  }>(
    `SELECT id, project_id, confidence, foundational, times_applied,
            COALESCE(times_confirmed, 0) as times_confirmed,
            COALESCE(promotion_status, 'not_ready') as promotion_status,
            archived_at
     FROM learnings WHERE id = ? AND project_id = ?`,
    [id, projectId]
  );

  if (!learning) {
    throw new Error(`Learning #${id} not found`);
  }

  // Update: increment confidence and times_confirmed
  await db.run(
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

  // Increase review interval after each confirmation (cap 120)
  await db.run(
    `UPDATE learnings SET review_after_sessions = MIN(120, COALESCE(review_after_sessions, 30) + 10) WHERE id = ?`,
    [id]
  );

  // After confirming, switch back to pending for next review cycle
  await db.run(
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
      await db.run(`UPDATE learnings SET promotion_status = 'candidate' WHERE id = ?`, [id]);
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
export async function reviseFoundationalLearning(
  db: DatabaseAdapter,
  projectId: number,
  id: number,
  newContent: string,
  _notes?: string
): Promise<void> {
  const learning = await db.get<{ id: number; project_id: number }>(
    "SELECT id, project_id FROM learnings WHERE id = ? AND project_id = ?",
    [id, projectId]
  );

  if (!learning) {
    throw new Error(`Learning #${id} not found`);
  }

  await db.run(
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

  // Reset review interval on revision
  await db.run(
    `UPDATE learnings SET review_after_sessions = 30 WHERE id = ?`,
    [id]
  );

  // After revising, switch back to pending for next review cycle
  await db.run(
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
export async function handleFoundationalCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "due":
    case "review":
    case "list":
    case undefined: {
      const due = await getFoundationalLearningsDue(db, projectId);

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
        await confirmFoundationalLearning(db, projectId, id, notes);
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
        await reviseFoundationalLearning(db, projectId, id, newContent);
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
