/**
 * Muninn MCP Server — Session Lifecycle
 *
 * Worker spawning, session auto-start, and session auto-end logic.
 */

import type { DatabaseAdapter } from "./database/adapter";
import { createLogger } from "./lib/logger.js";
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
    // Detach from parent — let worker run independently
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
    if (activeSession) return; // Session already active

    const mod = await import("./commands/session.js");
    await captureOutput(async () => { await mod.sessionStart(db, projectId, "Auto-started session"); });
    log.info("Auto-started session");
  } catch {
    // Non-critical — session tracking is best-effort
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

    // Get tool call summary for this session
    const toolSummary = await db.all<{ tool_name: string; cnt: number }>(
      `SELECT tool_name, COUNT(*) as cnt FROM tool_calls
       WHERE session_id = ? GROUP BY tool_name ORDER BY cnt DESC LIMIT 10`,
      [activeSession.id]
    );

    const summaryText = toolSummary.length > 0
      ? `Tools used: ${toolSummary.map((t) => `${t.tool_name} x${t.cnt}`).join(", ")}`
      : "No tool calls recorded";

    // v7 Phase 1B: Infer session outcome from observable signals
    let outcomeText = summaryText;
    try {
      const { inferSessionOutcome } = await import("./outcomes/auto-outcome.js");
      const inferred = await inferSessionOutcome(db, projectId, activeSession.id);
      outcomeText = `${summaryText}. ${inferred.summary}`;

      // Store inferred success level
      await db.run(
        `UPDATE sessions SET ended_at = datetime('now'), outcome = ?, success = ? WHERE id = ?`,
        [outcomeText, inferred.success, activeSession.id]
      );
    } catch {
      // Fallback: just set the basic outcome
      await db.run(
        `UPDATE sessions SET ended_at = datetime('now'), outcome = ? WHERE id = ?`,
        [summaryText, activeSession.id]
      );
    }

    // v4 Phase 2: Queue background learning jobs for this session
    try {
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["map_error_fixes", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["detect_patterns", JSON.stringify({ projectId })]
      );
    } catch {
      // work_queue might not exist yet
    }

    // v4 Phase 5: Queue outcome intelligence jobs for this session
    try {
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["track_decisions", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["calibrate_confidence", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["process_context_feedback", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      // v5 Phase 1: Reinforce learnings after context feedback
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["reinforce_learnings", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
    } catch {
      // work_queue might not exist yet
    }

    // v4 Phase 6: Queue team intelligence jobs at session end
    try {
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["aggregate_learnings", JSON.stringify({ projectId })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["promote_reviews", JSON.stringify({ projectId })]
      );
    } catch {
      // work_queue might not exist yet
    }

    // v7 Phase 2A/4A: Queue reasoning extraction and impact classification
    try {
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["extract_reasoning_traces", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["classify_impact", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
    } catch {
      // work_queue might not exist yet
    }

    // v7 Phase 2B: Distill strategies every 5 sessions
    try {
      const sessionCount5 = await db.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?`,
        [projectId]
      );
      if (sessionCount5 && sessionCount5.cnt % 5 === 0) {
        await db.run(
          `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
          ["distill_strategies", JSON.stringify({ projectId })]
        );
      }
    } catch {
      // work_queue or sessions might not exist yet
    }

    // v7 Phase 3A: Build workflow model every 10 sessions
    try {
      const sessionCount10 = await db.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?`,
        [projectId]
      );
      if (sessionCount10 && sessionCount10.cnt % 10 === 0) {
        await db.run(
          `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
          ["build_workflow_model", JSON.stringify({ projectId })]
        );
      }
    } catch {
      // work_queue or sessions might not exist yet
    }

    // v7 Phase 1C: Regenerate codebase DNA every 20 sessions
    try {
      const sessionCount = await db.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?`,
        [projectId]
      );
      if (sessionCount && sessionCount.cnt % 20 === 0) {
        await db.run(
          `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
          ["generate_codebase_dna", JSON.stringify({ projectId })]
        );
      }
    } catch {
      // work_queue or sessions might not exist yet
    }

    // Spawn worker to process queued jobs
    spawnWorkerIfNeeded();

    log.info("Auto-ended session");
  } catch {
    // Best-effort — process is exiting
  }
}
