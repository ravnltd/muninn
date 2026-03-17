/**
 * Muninn HTTP Server — v9
 *
 * REST API wrapping the v9 handlers (recall, remember, track).
 * Lightweight Hono server on configurable port (default 3001).
 *
 * Endpoints:
 *   POST /api/v1/recall    — Retrieve context (files/query/task)
 *   POST /api/v1/remember  — Record decision or learning
 *   POST /api/v1/track     — Manage issues (add/resolve)
 *   GET  /api/v1/briefing  — Session briefing
 *   GET  /api/v1/health    — System health
 *   POST /api/v1/export    — Memory interchange format
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DatabaseAdapter } from "./database/adapter";
import {
  RecallInput,
  RememberInput,
  TrackInput,
  validateInput,
} from "./mcp-validation.js";
import {
  handleRecall,
  handleRemember,
  handleTrack,
} from "./mcp-handlers.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("http-server");

// ============================================================================
// Types
// ============================================================================

type AppEnv = {
  Variables: {
    db: DatabaseAdapter;
    projectId: number;
    cwd: string;
  };
};

// ============================================================================
// App Factory
// ============================================================================

export function createApp(db: DatabaseAdapter, projectId: number, cwd: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Global middleware
  app.use("*", cors({
    origin: ["http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:3000", "http://127.0.0.1:3000"],
  }));

  // Bearer token auth
  const apiToken = process.env.MUNINN_API_TOKEN;
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/v1/health") return next();
    if (apiToken) {
      const auth = c.req.header("Authorization");
      if (!auth || auth !== `Bearer ${apiToken}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }
    await next();
  });

  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("projectId", projectId);
    c.set("cwd", cwd);
    await next();
  });

  // Health check
  app.get("/api/v1/health", async (c) => {
    const startMs = Date.now();
    try {
      await db.get("SELECT 1");
      const dbLatency = Date.now() - startMs;

      const workerStats = { pending: 0, failed: 0, completed: 0 };
      try {
        const rows = await db.all<{ status: string; cnt: number }>(
          `SELECT status, COUNT(*) as cnt FROM work_queue
           WHERE created_at > datetime('now', '-1 day')
           GROUP BY status`,
        );
        for (const row of rows) {
          if (row.status === "pending") workerStats.pending = row.cnt;
          else if (row.status === "failed") workerStats.failed = row.cnt;
          else if (row.status === "completed") workerStats.completed = row.cnt;
        }
      } catch { /* table may not exist */ }

      return c.json({
        status: "ok",
        version: "9.0.0",
        dbLatencyMs: dbLatency,
        worker: workerStats,
      });
    } catch {
      return c.json({ status: "degraded", version: "9.0.0" }, 503);
    }
  });

  // Recall — context retrieval
  app.post("/api/v1/recall", async (c) => {
    const body = await c.req.json();
    const validation = validateInput(RecallInput, body);
    if (!validation.success) return c.json({ error: validation.error }, 400);
    const result = await handleRecall(db, projectId, cwd, validation.data);
    return c.json({ data: result });
  });

  // Remember — record decision or learning
  app.post("/api/v1/remember", async (c) => {
    const body = await c.req.json();
    const validation = validateInput(RememberInput, body);
    if (!validation.success) return c.json({ error: validation.error }, 400);
    const result = await handleRemember(db, projectId, validation.data);
    return c.json({ data: result });
  });

  // Track — issue management
  app.post("/api/v1/track", async (c) => {
    const body = await c.req.json();
    const validation = validateInput(TrackInput, body);
    if (!validation.success) return c.json({ error: validation.error }, 400);
    const result = await handleTrack(db, projectId, validation.data);
    return c.json({ data: result });
  });

  // Session briefing
  app.get("/api/v1/briefing", async (c) => {
    const sections: string[] = [];

    try {
      const last = await db.get<{ goal: string | null; outcome: string | null; success: number | null }>(
        `SELECT goal, outcome, success FROM sessions WHERE project_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`,
        [projectId],
      );
      if (last) {
        const labels = ["failed", "partial", "success"];
        sections.push(`Last session: ${last.goal ?? "unknown"} — ${labels[last.success ?? 0] ?? "unknown"}`);
      }
    } catch { /* table may not exist */ }

    return c.json({ data: sections.join("\n\n") });
  });

  // Memory interchange export
  app.post("/api/v1/export", async (c) => {
    const { exportMemory } = await import("./interchange/exporter.js");
    const exported = await exportMemory(db, projectId);
    return c.json(exported);
  });

  return app;
}

// ============================================================================
// Standalone Server
// ============================================================================

async function main(): Promise<void> {
  const port = parseInt(process.env.MUNINN_HTTP_PORT ?? "3001", 10);

  const { getGlobalDb } = await import("./database/connection.js");
  const db = await getGlobalDb();

  const cwd = process.cwd();
  const { basename } = await import("node:path");
  const projectName = basename(cwd);

  let project = await db.get<{ id: number }>(
    `SELECT id FROM projects WHERE path = ?`,
    [cwd],
  );
  if (!project) {
    await db.run(
      `INSERT OR IGNORE INTO projects (name, path) VALUES (?, ?)`,
      [projectName, cwd],
    );
    project = await db.get<{ id: number }>(
      `SELECT id FROM projects WHERE path = ?`,
      [cwd],
    );
  }
  const projectId = project!.id;

  const app = createApp(db, projectId, cwd);

  log.info(`Muninn HTTP API starting on port ${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });

  log.info(`Muninn HTTP API ready at http://localhost:${port}/api/v1/health`);
}

main().catch((error) => {
  log.error(`Fatal: ${error}`);
  process.exit(1);
});
