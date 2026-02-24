/**
 * Muninn HTTP Server — v7 Phase 6A
 *
 * REST API alongside MCP, wrapping the same handlers.
 * Lightweight Hono server on configurable port (default 3001).
 *
 * Usage:
 *   bun run src/http-server.ts
 *   MUNINN_HTTP_PORT=3001 bun run src/http-server.ts
 *
 * Endpoints:
 *   POST /api/v1/context   — Unified context retrieval
 *   POST /api/v1/memory    — Create learning/decision/issue
 *   POST /api/v1/session   — Manage sessions
 *   POST /api/v1/intent    — Multi-agent intents
 *   GET  /api/v1/briefing  — Session briefing + codebase DNA
 *   GET  /api/v1/health    — System health
 *   POST /api/v1/export    — Memory interchange format
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DatabaseAdapter } from "./database/adapter";
import {
  ContextInput,
  IntentInput,
  SessionInput,
  LearnAddInput,
  DecisionAddInput,
  IssueInput,
  validateInput,
} from "./mcp-validation.js";
import {
  handleContext,
  handleIntent,
  handleSessionStart,
  handleSessionEnd,
  handleLearnAdd,
  handleDecisionAdd,
  handleIssueAdd,
  handleIssueResolve,
} from "./mcp-handlers.js";
import { getActiveSessionId } from "./commands/session-tracking.js";
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

/**
 * Create a Hono app with all v1 API routes.
 * Accepts db and projectId so it can be mounted in tests or composed externally.
 */
export function createApp(db: DatabaseAdapter, projectId: number, cwd: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Global middleware
  app.use("*", cors());
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("projectId", projectId);
    c.set("cwd", cwd);
    await next();
  });

  // Health check
  app.get("/api/v1/health", async (c) => {
    try {
      await db.get("SELECT 1");
      return c.json({ status: "ok", version: "7.0.0" });
    } catch {
      return c.json({ status: "degraded", version: "7.0.0" }, 503);
    }
  });

  // Unified context
  app.post("/api/v1/context", async (c) => {
    const body = await c.req.json();
    const validation = validateInput(ContextInput, body);
    if (!validation.success) return c.json({ error: validation.error }, 400);

    const result = await handleContext(db, projectId, cwd, validation.data);
    return c.json({ data: result });
  });

  // Memory creation (learning, decision, issue)
  app.post("/api/v1/memory", async (c) => {
    const body = await c.req.json();
    const { type, ...params } = body as { type: string; [key: string]: unknown };

    switch (type) {
      case "learning": {
        const validation = validateInput(LearnAddInput, params);
        if (!validation.success) return c.json({ error: validation.error }, 400);
        const result = await handleLearnAdd(db, projectId, validation.data);
        return c.json({ data: result });
      }
      case "decision": {
        const validation = validateInput(DecisionAddInput, params);
        if (!validation.success) return c.json({ error: validation.error }, 400);
        const result = await handleDecisionAdd(db, projectId, validation.data);
        return c.json({ data: result });
      }
      case "issue": {
        const validation = validateInput(IssueInput, params);
        if (!validation.success) return c.json({ error: validation.error }, 400);
        if (params.action === "resolve") {
          const result = await handleIssueResolve(db, validation.data as { id: number; resolution: string });
          return c.json({ data: result });
        }
        const result = await handleIssueAdd(db, projectId, validation.data as { title: string; description?: string; severity?: number; type?: string });
        return c.json({ data: result });
      }
      default:
        return c.json({ error: "Unknown memory type. Use: learning, decision, issue" }, 400);
    }
  });

  // Session management
  app.post("/api/v1/session", async (c) => {
    const body = await c.req.json();
    const validation = validateInput(SessionInput, body);
    if (!validation.success) return c.json({ error: validation.error }, 400);

    const data = validation.data;
    if (data.action === "start") {
      const result = await handleSessionStart(db, projectId, data, cwd);
      return c.json({ data: result });
    }
    const result = await handleSessionEnd(db, projectId, data);
    return c.json({ data: result });
  });

  // Multi-agent intents
  app.post("/api/v1/intent", async (c) => {
    const body = await c.req.json();
    const validation = validateInput(IntentInput, body);
    if (!validation.success) return c.json({ error: validation.error }, 400);

    const sessionId = await getActiveSessionId(db, projectId);
    const result = await handleIntent(db, projectId, sessionId, validation.data);
    return c.json({ data: JSON.parse(result) });
  });

  // Session briefing
  app.get("/api/v1/briefing", async (c) => {
    const sections: string[] = [];

    // Codebase DNA
    try {
      const { loadDNA } = await import("./context/codebase-dna.js");
      const dna = await loadDNA(db, projectId);
      if (dna) sections.push(dna.formatted);
    } catch { /* table may not exist */ }

    // Last session
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

  // Get or create project
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
