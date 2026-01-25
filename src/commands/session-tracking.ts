/**
 * Session Tracking Helpers
 * Track file reads, queries, and entity modifications within a session
 */

import type { Database } from "bun:sqlite";
import { safeJsonParse } from "../utils/errors";

/**
 * Get the current active session ID for a project
 */
export function getActiveSessionId(db: Database, projectId: number): number | null {
  const session = db
    .query<{ id: number }, [number]>(`
    SELECT id FROM sessions
    WHERE project_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `)
    .get(projectId);

  return session?.id || null;
}

/**
 * Track a file read in the current active session
 */
export function trackFileRead(db: Database, projectId: number, filePath: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db
    .query<{ files_read: string | null }, [number]>(`
    SELECT files_read FROM sessions WHERE id = ?
  `)
    .get(sessionId);

  const filesRead = safeJsonParse<string[]>(session?.files_read || "[]", []);

  if (!filesRead.includes(filePath)) {
    filesRead.push(filePath);
    db.run(
      `
      UPDATE sessions SET files_read = ? WHERE id = ?
    `,
      [JSON.stringify(filesRead), sessionId]
    );
  }
}

/**
 * Track a query made in the current active session
 */
export function trackQuery(db: Database, projectId: number, query: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db
    .query<{ queries_made: string | null }, [number]>(`
    SELECT queries_made FROM sessions WHERE id = ?
  `)
    .get(sessionId);

  const queriesMade = safeJsonParse<string[]>(session?.queries_made || "[]", []);

  // Keep last 50 queries to avoid unbounded growth
  if (queriesMade.length >= 50) {
    queriesMade.shift();
  }

  queriesMade.push(query);
  db.run(
    `
    UPDATE sessions SET queries_made = ? WHERE id = ?
  `,
    [JSON.stringify(queriesMade), sessionId]
  );
}

/**
 * Track a file modification in the current active session
 */
export function trackFileTouched(db: Database, projectId: number, filePath: string): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db
    .query<{ files_touched: string | null }, [number]>(`
    SELECT files_touched FROM sessions WHERE id = ?
  `)
    .get(sessionId);

  const filesTouched = safeJsonParse<string[]>(session?.files_touched || "[]", []);

  if (!filesTouched.includes(filePath)) {
    filesTouched.push(filePath);
    db.run(
      `
      UPDATE sessions SET files_touched = ? WHERE id = ?
    `,
      [JSON.stringify(filesTouched), sessionId]
    );
  }
}

/**
 * Track a decision made in the current active session
 */
export function trackDecisionMade(db: Database, projectId: number, decisionId: number): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db
    .query<{ decisions_made: string | null }, [number]>(`
    SELECT decisions_made FROM sessions WHERE id = ?
  `)
    .get(sessionId);

  const decisionsMade = safeJsonParse<number[]>(session?.decisions_made || "[]", []);

  if (!decisionsMade.includes(decisionId)) {
    decisionsMade.push(decisionId);
    db.run(
      `
      UPDATE sessions SET decisions_made = ? WHERE id = ?
    `,
      [JSON.stringify(decisionsMade), sessionId]
    );
  }
}

/**
 * Track an issue found in the current active session
 */
export function trackIssueFound(db: Database, projectId: number, issueId: number): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db
    .query<{ issues_found: string | null }, [number]>(`
    SELECT issues_found FROM sessions WHERE id = ?
  `)
    .get(sessionId);

  const issuesFound = safeJsonParse<number[]>(session?.issues_found || "[]", []);

  if (!issuesFound.includes(issueId)) {
    issuesFound.push(issueId);
    db.run(
      `
      UPDATE sessions SET issues_found = ? WHERE id = ?
    `,
      [JSON.stringify(issuesFound), sessionId]
    );
  }
}

/**
 * Track an issue resolved in the current active session
 */
export function trackIssueResolved(db: Database, projectId: number, issueId: number): void {
  const sessionId = getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = db
    .query<{ issues_resolved: string | null }, [number]>(`
    SELECT issues_resolved FROM sessions WHERE id = ?
  `)
    .get(sessionId);

  const issuesResolved = safeJsonParse<number[]>(session?.issues_resolved || "[]", []);

  if (!issuesResolved.includes(issueId)) {
    issuesResolved.push(issueId);
    db.run(
      `
      UPDATE sessions SET issues_resolved = ? WHERE id = ?
    `,
      [JSON.stringify(issuesResolved), sessionId]
    );
  }
}
