/**
 * Session commands
 * Track work sessions with goals, outcomes, and next steps
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess, getTimeAgo } from "../utils/format";
import { exitWithUsage, safeJsonParse } from "../utils/errors";
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

  if (lastSession.queries_made) {
    try {
      const queries = JSON.parse(lastSession.queries_made as string);
      if (queries.length > 0) {
        md += `## Queries Made\n`;
        for (const q of queries.slice(0, 5)) {
          md += `- "${q}"\n`;
        }
        if (queries.length > 5) {
          md += `- ...and ${queries.length - 5} more\n`;
        }
        md += "\n";
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  if (lastSession.next_steps) {
    md += `## Next Steps\n`;
    // Parse next_steps as a checklist if it contains bullet points
    const nextSteps = lastSession.next_steps as string;
    if (nextSteps.includes("\n") || nextSteps.includes("-")) {
      const steps = nextSteps.split(/[\n•-]/).map(s => s.trim()).filter(Boolean);
      for (const step of steps) {
        md += `- [ ] ${step}\n`;
      }
    } else {
      md += `- [ ] ${nextSteps}\n`;
    }
    md += "\n";
  }

  if (lastSession.learnings) {
    md += `## Learnings from Session\n`;
    md += `${lastSession.learnings}\n\n`;
  }

  // Add context about issues found/resolved
  if (lastSession.issues_found || lastSession.issues_resolved) {
    const found = safeJsonParse<number[]>(lastSession.issues_found as string, []);
    const resolved = safeJsonParse<number[]>(lastSession.issues_resolved as string, []);

    if (found.length > 0 || resolved.length > 0) {
      md += `## Issues\n`;
      if (found.length > 0) {
        md += `- Found: ${found.map(id => `#${id}`).join(", ")}\n`;
      }
      if (resolved.length > 0) {
        md += `- Resolved: ${resolved.map(id => `#${id}`).join(", ")}\n`;
      }
      md += "\n";
    }
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

// ============================================================================
// Session Tracking Helpers
// ============================================================================

/**
 * Get the current active session ID for a project
 */
export function getActiveSessionId(db: Database, projectId: number): number | null {
  const session = db.query<{ id: number }, [number]>(`
    SELECT id FROM sessions
    WHERE project_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `).get(projectId);

  return session?.id || null;
}

/**
 * Track a file read in the current active session
 */
export function trackFileRead(db: Database, projectId: number, filePath: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ files_read: string | null }, [number]>(`
    SELECT files_read FROM sessions WHERE id = ?
  `).get(sessionId);

  const filesRead = safeJsonParse<string[]>(session?.files_read || "[]", []);

  if (!filesRead.includes(filePath)) {
    filesRead.push(filePath);
    db.run(`
      UPDATE sessions SET files_read = ? WHERE id = ?
    `, [JSON.stringify(filesRead), sessionId]);
  }
}

/**
 * Track a query made in the current active session
 */
export function trackQuery(db: Database, projectId: number, query: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ queries_made: string | null }, [number]>(`
    SELECT queries_made FROM sessions WHERE id = ?
  `).get(sessionId);

  const queriesMade = safeJsonParse<string[]>(session?.queries_made || "[]", []);

  // Keep last 50 queries to avoid unbounded growth
  if (queriesMade.length >= 50) {
    queriesMade.shift();
  }

  queriesMade.push(query);
  db.run(`
    UPDATE sessions SET queries_made = ? WHERE id = ?
  `, [JSON.stringify(queriesMade), sessionId]);
}

/**
 * Track a file modification in the current active session
 */
export function trackFileTouched(db: Database, projectId: number, filePath: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ files_touched: string | null }, [number]>(`
    SELECT files_touched FROM sessions WHERE id = ?
  `).get(sessionId);

  const filesTouched = safeJsonParse<string[]>(session?.files_touched || "[]", []);

  if (!filesTouched.includes(filePath)) {
    filesTouched.push(filePath);
    db.run(`
      UPDATE sessions SET files_touched = ? WHERE id = ?
    `, [JSON.stringify(filesTouched), sessionId]);
  }
}

/**
 * Track an issue found in the current active session
 */
export function trackIssueFound(db: Database, projectId: number, issueId: number): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ issues_found: string | null }, [number]>(`
    SELECT issues_found FROM sessions WHERE id = ?
  `).get(sessionId);

  const issuesFound = safeJsonParse<number[]>(session?.issues_found || "[]", []);

  if (!issuesFound.includes(issueId)) {
    issuesFound.push(issueId);
    db.run(`
      UPDATE sessions SET issues_found = ? WHERE id = ?
    `, [JSON.stringify(issuesFound), sessionId]);
  }
}

/**
 * Track an issue resolved in the current active session
 */
export function trackIssueResolved(db: Database, projectId: number, issueId: number): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db.query<{ issues_resolved: string | null }, [number]>(`
    SELECT issues_resolved FROM sessions WHERE id = ?
  `).get(sessionId);

  const issuesResolved = safeJsonParse<number[]>(session?.issues_resolved || "[]", []);

  if (!issuesResolved.includes(issueId)) {
    issuesResolved.push(issueId);
    db.run(`
      UPDATE sessions SET issues_resolved = ? WHERE id = ?
    `, [JSON.stringify(issuesResolved), sessionId]);
  }
}
