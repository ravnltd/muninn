/**
 * Session Tracking Helpers
 * Track file reads, queries, and entity modifications within a session
 */

import type { DatabaseAdapter } from "../database/adapter";
import { safeJsonParse } from "../utils/errors";

/**
 * Get the current active session ID for a project
 */
export async function getActiveSessionId(db: DatabaseAdapter, projectId: number): Promise<number | null> {
  const session = await db.get<{ id: number }>(
    `
    SELECT id FROM sessions
    WHERE project_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `,
    [projectId]
  );

  return session?.id || null;
}

/**
 * Track a file read in the current active session
 */
export async function trackFileRead(db: DatabaseAdapter, projectId: number, filePath: string): Promise<void> {
  const sessionId = await getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = await db.get<{ files_read: string | null }>(
    `
    SELECT files_read FROM sessions WHERE id = ?
  `,
    [sessionId]
  );

  const filesRead = safeJsonParse<string[]>(session?.files_read || "[]", []);

  if (!filesRead.includes(filePath)) {
    filesRead.push(filePath);
    await db.run(
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
export async function trackQuery(db: DatabaseAdapter, projectId: number, query: string): Promise<void> {
  const sessionId = await getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = await db.get<{ queries_made: string | null }>(
    `
    SELECT queries_made FROM sessions WHERE id = ?
  `,
    [sessionId]
  );

  const queriesMade = safeJsonParse<string[]>(session?.queries_made || "[]", []);

  // Keep last 50 queries to avoid unbounded growth
  if (queriesMade.length >= 50) {
    queriesMade.shift();
  }

  queriesMade.push(query);
  await db.run(
    `
    UPDATE sessions SET queries_made = ? WHERE id = ?
  `,
    [JSON.stringify(queriesMade), sessionId]
  );
}

/**
 * Track a file modification in the current active session
 */
export async function trackFileTouched(db: DatabaseAdapter, projectId: number, filePath: string): Promise<void> {
  const sessionId = await getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = await db.get<{ files_touched: string | null }>(
    `
    SELECT files_touched FROM sessions WHERE id = ?
  `,
    [sessionId]
  );

  const filesTouched = safeJsonParse<string[]>(session?.files_touched || "[]", []);

  if (!filesTouched.includes(filePath)) {
    filesTouched.push(filePath);
    await db.run(
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
export async function trackDecisionMade(db: DatabaseAdapter, projectId: number, decisionId: number): Promise<void> {
  const sessionId = await getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = await db.get<{ decisions_made: string | null }>(
    `
    SELECT decisions_made FROM sessions WHERE id = ?
  `,
    [sessionId]
  );

  const decisionsMade = safeJsonParse<number[]>(session?.decisions_made || "[]", []);

  if (!decisionsMade.includes(decisionId)) {
    decisionsMade.push(decisionId);
    await db.run(
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
export async function trackIssueFound(db: DatabaseAdapter, projectId: number, issueId: number): Promise<void> {
  const sessionId = await getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = await db.get<{ issues_found: string | null }>(
    `
    SELECT issues_found FROM sessions WHERE id = ?
  `,
    [sessionId]
  );

  const issuesFound = safeJsonParse<number[]>(session?.issues_found || "[]", []);

  if (!issuesFound.includes(issueId)) {
    issuesFound.push(issueId);
    await db.run(
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
export async function trackIssueResolved(db: DatabaseAdapter, projectId: number, issueId: number): Promise<void> {
  const sessionId = await getActiveSessionId(db, projectId);
  if (!sessionId) return;

  const session = await db.get<{ issues_resolved: string | null }>(
    `
    SELECT issues_resolved FROM sessions WHERE id = ?
  `,
    [sessionId]
  );

  const issuesResolved = safeJsonParse<number[]>(session?.issues_resolved || "[]", []);

  if (!issuesResolved.includes(issueId)) {
    issuesResolved.push(issueId);
    await db.run(
      `
      UPDATE sessions SET issues_resolved = ? WHERE id = ?
    `,
      [JSON.stringify(issuesResolved), sessionId]
    );
  }
}
