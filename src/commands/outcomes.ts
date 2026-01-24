/**
 * Outcome Tracking
 * Track whether architectural decisions worked out over time.
 * Decisions are reviewed after N sessions to determine success/failure.
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess } from "../utils/format";
import type { OutcomeStatus } from "../types";

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
  const decision = db.query<{ id: number; title: string; project_id: number }, [number, number]>(
    "SELECT id, title, project_id FROM decisions WHERE id = ? AND project_id = ?"
  ).get(decisionId, projectId);

  if (!decision) {
    throw new Error(`Decision #${decisionId} not found`);
  }

  db.run(`
    UPDATE decisions SET
      outcome_status = ?,
      outcome_notes = ?,
      outcome_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [status, notes ?? null, decisionId]);
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
    return db.query<{
      id: number;
      title: string;
      decision: string;
      sessions_since: number;
      check_after_sessions: number;
      decided_at: string;
    }, [number]>(`
      SELECT id, title, decision, sessions_since, check_after_sessions, decided_at
      FROM decisions
      WHERE project_id = ?
        AND status = 'active'
        AND outcome_status = 'pending'
        AND sessions_since >= check_after_sessions
      ORDER BY sessions_since DESC
      LIMIT 10
    `).all(projectId);
  } catch {
    return []; // Columns might not exist yet
  }
}

// ============================================================================
// Increment Sessions Since (called on session start)
// ============================================================================

export function incrementSessionsSince(db: Database, projectId: number): void {
  try {
    db.run(`
      UPDATE decisions SET sessions_since = sessions_since + 1
      WHERE project_id = ?
        AND status = 'active'
        AND outcome_status = 'pending'
    `, [projectId]);
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
      const id = parseInt(args[1]);
      const status = args[2] as OutcomeStatus;
      const notes = args.slice(3).join(" ") || undefined;

      if (!id || !status || !['succeeded', 'failed', 'revised', 'unknown'].includes(status)) {
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
