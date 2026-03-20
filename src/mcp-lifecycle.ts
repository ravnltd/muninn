/**
 * Muninn MCP Server — Session Lifecycle (v9 Simplified)
 *
 * Worker spawning, session auto-start, and session auto-end logic.
 * v9: Reduced to 3 essential session-end jobs:
 *   1. detect_patterns — Pattern detection from session activity
 *   2. track_decisions — Update decision outcome tracking
 *   3. reinforce_learnings — Learning promotion/archival
 */

import type { DatabaseAdapter } from "./database/adapter";
import { createLogger } from "./lib/logger.js";
import { silentCatch } from "./utils/silent-catch.js";
import { captureOutput } from "./mcp-handlers.js";
import {
  getDb,
  getProjectId,
  getLastWorkerSpawnAt,
  setLastWorkerSpawnAt,
  WORKER_SPAWN_COOLDOWN_MS,
} from "./mcp-state.js";

const log = createLogger("mcp-lifecycle");

/** Spawn the background worker if enough time has passed since last spawn */
export function spawnWorkerIfNeeded(): void {
  const now = Date.now();
  if (now - getLastWorkerSpawnAt() < WORKER_SPAWN_COOLDOWN_MS) return;
  setLastWorkerSpawnAt(now);

  try {
    const workerPath = new URL("./worker.ts", import.meta.url).pathname;
    const proc = Bun.spawn(["bun", "run", workerPath, "--once"], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env },
    });
    proc.unref();
    log.info("Spawned background worker");
  } catch (err) {
    log.error(`Failed to spawn worker: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Auto-start a session on first tool call if none is active */
export async function autoStartSession(db: DatabaseAdapter, projectId: number): Promise<void> {
  try {
    const activeSession = await db.get<{ id: number }>(
      `SELECT id FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      [projectId]
    );
    if (activeSession) return;

    // Auto-bootstrap if files table is empty (first-run)
    try {
      const fileCount = await db.get<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM files WHERE project_id = ?",
        [projectId]
      );
      if (fileCount && fileCount.cnt === 0) {
        const { bootstrap } = await import("./commands/bootstrap.js");
        const result = await bootstrap(db, projectId, process.cwd());
        if (!result.skipped && result.files > 0) {
          log.info(`Bootstrapped ${result.files} files from ${result.commits} commits`);
        }
      }
    } catch (e) {
      silentCatch("lifecycle:auto-bootstrap")(e);
    }

    const mod = await import("./commands/session.js");
    await captureOutput(async () => { await mod.sessionStart(db, projectId, "Auto-started session"); });
    log.info("Auto-started session");
  } catch (e) {
    silentCatch("lifecycle:auto-start-session")(e);
  }
}

/** Auto-end session on process termination */
export async function autoEndSession(): Promise<void> {
  try {
    const db = await getDb();
    const defaultCwd = process.cwd();
    const projectId = await getProjectId(db, defaultCwd);

    const activeSession = await db.get<{ id: number }>(
      `SELECT id FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      [projectId]
    );
    if (!activeSession) return;

    // Get tool call summary
    const toolSummary = await db.all<{ tool_name: string; cnt: number }>(
      `SELECT tool_name, COUNT(*) as cnt FROM tool_calls
       WHERE session_id = ? GROUP BY tool_name ORDER BY cnt DESC LIMIT 10`,
      [activeSession.id]
    );

    const summaryText = toolSummary.length > 0
      ? `Tools used: ${toolSummary.map((t) => `${t.tool_name} x${t.cnt}`).join(", ")}`
      : "No tool calls recorded";

    // Infer session outcome
    let outcomeText = summaryText;
    try {
      const { inferSessionOutcome } = await import("./outcomes/auto-outcome.js");
      const inferred = await inferSessionOutcome(db, projectId, activeSession.id);
      outcomeText = `${summaryText}. ${inferred.summary}`;
      await db.run(
        `UPDATE sessions SET ended_at = datetime('now'), outcome = ?, success = ? WHERE id = ?`,
        [outcomeText, inferred.success, activeSession.id]
      );
    } catch (e) {
      silentCatch("lifecycle:infer-outcome")(e);
      await db.run(
        `UPDATE sessions SET ended_at = datetime('now'), outcome = ? WHERE id = ?`,
        [summaryText, activeSession.id]
      );
    }

    // Queue 3 essential background jobs
    try {
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["detect_patterns", JSON.stringify({ projectId })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["track_decisions", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["reinforce_learnings", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
    } catch (e) {
      silentCatch("lifecycle:queue-jobs")(e);
    }

    // Spawn worker to process queued jobs
    spawnWorkerIfNeeded();

    log.info("Auto-ended session");
  } catch (e) {
    silentCatch("lifecycle:auto-end-session")(e);
  }
}
