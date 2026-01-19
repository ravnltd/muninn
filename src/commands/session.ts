/**
 * Session commands
 * Track work sessions with goals, outcomes, and next steps
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess, getTimeAgo } from "../utils/format";
import { exitWithUsage } from "../utils/errors";
import { parseSessionEndArgs } from "../utils/validation";

// ============================================================================
// Session Start
// ============================================================================

export function sessionStart(db: Database, projectId: number, goal: string): number {
  if (!goal) {
    exitWithUsage("Usage: context session start <goal>");
  }

  const result = db.run(`
    INSERT INTO sessions (project_id, goal)
    VALUES (?, ?)
  `, [projectId, goal]);

  const sessionId = Number(result.lastInsertRowid);

  console.error(`\n🚀 Session #${sessionId} started`);
  console.error(`   Goal: ${goal}`);
  console.error(`\n   When done, run: context session end ${sessionId}`);
  console.error("");

  outputSuccess({ sessionId, goal });
  return sessionId;
}

// ============================================================================
// Session End
// ============================================================================

export function sessionEnd(db: Database, sessionId: number, args: string[]): void {
  const { values } = parseSessionEndArgs(args);

  if (!sessionId) {
    exitWithUsage("Usage: context session end <id> [--outcome <text>] [--next <steps>] [--success 0-2]");
  }

  // Verify session exists
  const session = db.query<{ id: number; goal: string }, [number]>(
    "SELECT id, goal FROM sessions WHERE id = ?"
  ).get(sessionId);

  if (!session) {
    console.error(`❌ Session #${sessionId} not found`);
    process.exit(1);
  }

  db.run(`
    UPDATE sessions SET
      ended_at = CURRENT_TIMESTAMP,
      outcome = ?,
      files_touched = ?,
      learnings = ?,
      next_steps = ?,
      success = ?
    WHERE id = ?
  `, [
    values.outcome || null,
    values.files || null,
    values.learnings || null,
    values.next || null,
    values.success ?? null,
    sessionId,
  ]);

  console.error(`\n✅ Session #${sessionId} ended`);
  if (values.outcome) {
    console.error(`   Outcome: ${values.outcome}`);
  }
  if (values.next) {
    console.error(`   Next: ${values.next}`);
  }
  console.error("");

  outputSuccess({ sessionId });
}

// ============================================================================
// Session Last
// ============================================================================

export function sessionLast(db: Database, projectId: number): void {
  const session = db.query<Record<string, unknown>, [number]>(`
    SELECT * FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(projectId);

  if (!session) {
    console.error("No sessions found. Start one with: context session start <goal>");
    outputJson({ found: false });
    return;
  }

  const timeAgo = getTimeAgo(session.started_at as string);
  const isOngoing = !session.ended_at;

  console.error(`\n📋 Last Session (#${session.id}) - ${timeAgo}`);
  console.error(`   Goal: ${session.goal || 'Not specified'}`);

  if (session.outcome) {
    console.error(`   Outcome: ${session.outcome}`);
  }

  if (isOngoing) {
    console.error(`   Status: IN PROGRESS`);
    console.error(`\n   End with: context session end ${session.id}`);
  } else {
    if (session.next_steps) {
      console.error(`   Next: ${session.next_steps}`);
    }
  }
  console.error("");

  outputJson(session);
}

// ============================================================================
// Session List
// ============================================================================

export function sessionList(db: Database, projectId: number, limit: number = 10): void {
  const sessions = db.query<Record<string, unknown>, [number, number]>(`
    SELECT id, goal, outcome, started_at, ended_at, success
    FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(projectId, limit);

  if (sessions.length === 0) {
    console.error("No sessions found.");
    outputJson([]);
    return;
  }

  console.error("\n📋 Recent Sessions:\n");

  for (const s of sessions) {
    const timeAgo = getTimeAgo(s.started_at as string);
    const isOngoing = !s.ended_at;
    const successIcon = s.success === 2 ? '✅' : s.success === 1 ? '⚠️' : s.success === 0 ? '❌' : '⚪';

    console.error(`  ${successIcon} #${s.id} (${timeAgo})${isOngoing ? ' [ONGOING]' : ''}`);
    console.error(`     ${(s.goal as string)?.substring(0, 60) || 'No goal'}...`);
  }
  console.error("");

  outputJson(sessions);
}

// ============================================================================
// Resume from Last Session
// ============================================================================

export function generateResume(db: Database, projectId: number): string {
  const lastSession = db.query<Record<string, unknown>, [number]>(`
    SELECT * FROM sessions
    WHERE project_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(projectId);

  if (!lastSession) {
    return "No previous sessions found. Start fresh with `context session start \"Your goal\"`";
  }

  const timeAgo = getTimeAgo((lastSession.ended_at || lastSession.started_at) as string);
  const isOngoing = !lastSession.ended_at;

  let md = `# Resume Point\n\n`;
  md += `**Last session:** ${timeAgo}${isOngoing ? " (still ongoing)" : ""}\n`;
  md += `**Goal:** ${lastSession.goal || "Not specified"}\n`;

  if (lastSession.outcome) {
    md += `**Outcome:** ${lastSession.outcome}\n`;
  }

  md += "\n";

  if (lastSession.files_touched) {
    try {
      const files = JSON.parse(lastSession.files_touched as string);
      if (files.length > 0) {
        md += `## Files Modified\n`;
        for (const f of files) {
          md += `- ${f}\n`;
        }
        md += "\n";
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  if (lastSession.files_read) {
    try {
      const files = JSON.parse(lastSession.files_read as string);
      if (files.length > 0) {
        md += `## Files Read\n`;
        for (const f of files.slice(0, 10)) {
          md += `- ${f}\n`;
        }
        if (files.length > 10) {
          md += `- ...and ${files.length - 10} more\n`;
        }
        md += "\n";
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  if (lastSession.next_steps) {
    md += `## Next Steps\n`;
    md += `${lastSession.next_steps}\n\n`;
  }

  if (lastSession.learnings) {
    md += `## Learnings from Session\n`;
    md += `${lastSession.learnings}\n\n`;
  }

  if (isOngoing) {
    md += `---\n`;
    md += `Session still in progress. Use \`context session end ${lastSession.id}\` to close it.\n`;
  } else {
    const goalPreview = ((lastSession.goal as string) || "previous work").substring(0, 40);
    md += `---\n`;
    md += `Continue with: \`context session start "Continue: ${goalPreview}"\`\n`;
  }

  return md;
}
