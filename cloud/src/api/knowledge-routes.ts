/**
 * Knowledge API Routes — v6 Wave 1A
 *
 * Proxy authenticated requests to tenant databases for knowledge exploration.
 * Mirrors local dashboard API (src/web/routes/read.ts) with cloud auth.
 */

import { Hono } from "hono";
import { z } from "zod";
import { getTenantDb } from "../tenants/pool";
import type { AuthedEnv } from "./middleware";

// ============================================================================
// Types
// ============================================================================

interface DatabaseAdapter {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
  exec(sql: string): Promise<void>;
}

interface GraphNode {
  id: string;
  type: string;
  label: string;
  size: number;
  temperature?: string;
  fragilitySignals?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
}

// ============================================================================
// Helpers
// ============================================================================

const PaginationParams = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

function parseProjectId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function safeAll<T>(
  db: DatabaseAdapter,
  primary: string,
  fallback: string,
  params: unknown[],
): Promise<T[]> {
  try {
    return await db.all<T>(primary, params);
  } catch {
    return await db.all<T>(fallback, params);
  }
}

async function safeGet<T>(
  db: DatabaseAdapter,
  primary: string,
  fallback: string,
  params: unknown[],
): Promise<T | undefined> {
  try {
    return await db.get<T>(primary, params);
  } catch {
    return await db.get<T>(fallback, params);
  }
}

function escapeFtsQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

// ============================================================================
// Routes
// ============================================================================

const knowledgeRoutes = new Hono<AuthedEnv>();

// GET /projects — List tenant's projects
knowledgeRoutes.get("/projects", async (c) => {
  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const projects = await db.all(
      "SELECT id, name, path, status, mode FROM projects ORDER BY updated_at DESC",
    );
    return c.json(projects);
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/health — Health overview
knowledgeRoutes.get("/projects/:id/health", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const project = await db.get<{ id: number; name: string }>(
      "SELECT id, name, path, status, mode FROM projects WHERE id = ?",
      [projectId],
    );
    if (!project) return c.json({ error: "Project not found" }, 404);

    const [fileCount, openIssues, activeDecisions, fragileFiles, recentSessions, techDebtScore] =
      await Promise.all([
        db.get<{ count: number }>("SELECT COUNT(*) as count FROM files WHERE project_id = ?", [projectId]),
        db.get<{ count: number }>("SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND status = 'open'", [projectId]),
        db.get<{ count: number }>("SELECT COUNT(*) as count FROM decisions WHERE project_id = ? AND status = 'active'", [projectId]),
        safeAll(db,
          "SELECT id, path, purpose, fragility, temperature, velocity_score FROM files WHERE project_id = ? AND fragility >= 5 ORDER BY fragility DESC LIMIT 10",
          "SELECT id, path, purpose, fragility, NULL as temperature, NULL as velocity_score FROM files WHERE project_id = ? AND fragility >= 5 ORDER BY fragility DESC LIMIT 10",
          [projectId],
        ),
        safeAll(db,
          "SELECT id, goal, outcome, started_at, ended_at, success, session_number FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 10",
          "SELECT id, goal, outcome, started_at, ended_at, success, NULL as session_number FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 10",
          [projectId],
        ),
        safeGet<{ count: number }>(db,
          "SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND type = 'tech-debt' AND status = 'open'",
          "SELECT 0 as count",
          [projectId],
        ),
      ]);

    return c.json({
      project,
      fileCount: fileCount?.count ?? 0,
      openIssues: openIssues?.count ?? 0,
      activeDecisions: activeDecisions?.count ?? 0,
      fragileFiles,
      recentSessions,
      techDebtScore: Math.min((techDebtScore?.count ?? 0) * 10, 100),
    });
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/files — Files with pagination
knowledgeRoutes.get("/projects/:id/files", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const params = PaginationParams.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const { limit, offset } = params.success ? params.data : { limit: 500, offset: 0 };

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const files = await safeAll(db,
      "SELECT id, path, purpose, fragility, fragility_signals, temperature, archived_at, velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?",
      "SELECT id, path, purpose, fragility, NULL as fragility_signals, NULL as temperature, NULL as archived_at, NULL as velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?",
      [projectId, limit, offset],
    );
    return c.json(files);
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/decisions — Decisions with pagination
knowledgeRoutes.get("/projects/:id/decisions", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const params = PaginationParams.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const { limit, offset } = params.success ? params.data : { limit: 500, offset: 0 };

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const decisions = await safeAll(db,
      "SELECT id, title, decision, reasoning, status, outcome, outcome_notes, temperature, archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      "SELECT id, title, decision, NULL as reasoning, status, NULL as outcome, NULL as outcome_notes, NULL as temperature, NULL as archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [projectId, limit, offset],
    );
    return c.json(decisions);
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/learnings — Learnings with pagination
knowledgeRoutes.get("/projects/:id/learnings", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const params = PaginationParams.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const { limit, offset } = params.success ? params.data : { limit: 500, offset: 0 };

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const learnings = await safeAll(db,
      "SELECT id, title, content, category, confidence, auto_reinforcement_count, temperature, archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
      "SELECT id, title, content, NULL as category, NULL as confidence, NULL as auto_reinforcement_count, NULL as temperature, NULL as archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [projectId, limit, offset],
    );
    return c.json(learnings);
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/issues — Issues with pagination
knowledgeRoutes.get("/projects/:id/issues", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const params = PaginationParams.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const { limit, offset } = params.success ? params.data : { limit: 500, offset: 0 };

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const issues = await safeAll(db,
      "SELECT id, title, description, severity, status, type, resolution, temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?",
      "SELECT id, title, description, severity, status, NULL as type, NULL as resolution, NULL as temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?",
      [projectId, limit, offset],
    );
    return c.json(issues);
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/sessions — Session history
knowledgeRoutes.get("/projects/:id/sessions", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const sessions = await safeAll(db,
      "SELECT id, goal, outcome, started_at, ended_at, success, session_number, files_touched FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50",
      "SELECT id, goal, outcome, started_at, ended_at, success, NULL as session_number, files_touched FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50",
      [projectId],
    );
    return c.json(sessions);
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/memory — Batched endpoint (all 4 types in one call)
knowledgeRoutes.get("/projects/:id/memory", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const params = PaginationParams.safeParse({
    limit: c.req.query("limit") ?? "100",
    offset: c.req.query("offset"),
  });
  const { limit, offset } = params.success ? params.data : { limit: 100, offset: 0 };

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const [files, decisions, issues, learnings] = await Promise.all([
      safeAll(db,
        "SELECT id, path, purpose, fragility, fragility_signals, temperature, archived_at FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?",
        "SELECT id, path, purpose, fragility, NULL as fragility_signals, NULL as temperature, NULL as archived_at FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?",
        [projectId, limit, offset],
      ),
      safeAll(db,
        "SELECT id, title, decision, status, outcome, outcome_notes, temperature, archived_at, created_at FROM decisions WHERE project_id = ? AND (archived_at IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
        "SELECT id, title, decision, status, NULL as outcome, NULL as outcome_notes, NULL as temperature, NULL as archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [projectId, limit, offset],
      ),
      safeAll(db,
        "SELECT id, title, description, severity, status, type, temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?",
        "SELECT id, title, description, severity, status, NULL as type, NULL as temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?",
        [projectId, limit, offset],
      ),
      safeAll(db,
        "SELECT id, title, content, category, confidence, temperature, archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) AND (archived_at IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
        "SELECT id, title, content, NULL as category, NULL as confidence, NULL as temperature, NULL as archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [projectId, limit, offset],
      ),
    ]);

    return c.json({ files, decisions, issues, learnings });
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/graph — Knowledge graph nodes + edges
knowledgeRoutes.get("/projects/:id/graph", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const nodes: GraphNode[] = [];

    const [files, decisions, learnings, issues] = await Promise.all([
      safeAll<{ id: number; path: string; fragility: number; fragility_signals: string | null; temperature: string | null }>(db,
        "SELECT id, path, fragility, fragility_signals, temperature FROM files WHERE project_id = ? AND archived_at IS NULL",
        "SELECT id, path, fragility, NULL as fragility_signals, NULL as temperature FROM files WHERE project_id = ? AND archived_at IS NULL",
        [projectId],
      ),
      safeAll<{ id: number; title: string; temperature: string | null }>(db,
        "SELECT id, title, temperature FROM decisions WHERE project_id = ? AND archived_at IS NULL",
        "SELECT id, title, NULL as temperature FROM decisions WHERE project_id = ? AND archived_at IS NULL",
        [projectId],
      ),
      safeAll<{ id: number; title: string; temperature: string | null }>(db,
        "SELECT id, title, temperature FROM learnings WHERE (project_id = ? OR project_id IS NULL) AND archived_at IS NULL",
        "SELECT id, title, NULL as temperature FROM learnings WHERE (project_id = ? OR project_id IS NULL) AND archived_at IS NULL",
        [projectId],
      ),
      safeAll<{ id: number; title: string; severity: number; temperature: string | null }>(db,
        "SELECT id, title, severity, temperature FROM issues WHERE project_id = ? AND archived_at IS NULL",
        "SELECT id, title, severity, NULL as temperature FROM issues WHERE project_id = ? AND archived_at IS NULL",
        [projectId],
      ),
    ]);

    for (const f of files) {
      nodes.push({
        id: `file:${f.id}`,
        type: "file",
        label: f.path,
        size: Math.max(6, f.fragility),
        temperature: f.temperature ?? undefined,
        fragilitySignals: f.fragility_signals ?? undefined,
      });
    }
    for (const d of decisions) {
      nodes.push({ id: `decision:${d.id}`, type: "decision", label: d.title, size: 8, temperature: d.temperature ?? undefined });
    }
    for (const l of learnings) {
      nodes.push({ id: `learning:${l.id}`, type: "learning", label: l.title, size: 6, temperature: l.temperature ?? undefined });
    }
    for (const i of issues) {
      nodes.push({ id: `issue:${i.id}`, type: "issue", label: i.title, size: Math.max(6, i.severity), temperature: i.temperature ?? undefined });
    }

    // Build edges from relationships
    const nodeIds = new Set(nodes.map((n) => n.id));
    const relationships = await db.all<{
      source_type: string;
      source_id: number;
      target_type: string;
      target_id: number;
      relationship: string;
      strength: number;
    }>("SELECT source_type, source_id, target_type, target_id, relationship, strength FROM relationships");

    const edges: GraphEdge[] = relationships
      .map((r) => ({
        source: `${r.source_type}:${r.source_id}`,
        target: `${r.target_type}:${r.target_id}`,
        type: r.relationship,
        strength: r.strength,
      }))
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    return c.json({ nodes, edges });
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /projects/:id/search — FTS search
knowledgeRoutes.get("/projects/:id/search", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const query = c.req.query("q");
  if (!query || query.length < 2) return c.json([]);

  const safeFts = escapeFtsQuery(query);
  if (!safeFts || safeFts === '""') return c.json([]);

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const results = await db.all(
      `SELECT f.id, 'file' as type, f.path as title, f.purpose as content
       FROM fts_files JOIN files f ON fts_files.rowid = f.id
       WHERE fts_files MATCH ? AND f.project_id = ? AND f.archived_at IS NULL
       LIMIT 10`,
      [safeFts, projectId],
    );
    return c.json(results);
  } catch {
    return c.json([]);
  }
});

// GET /health-score — Composite health score (0-100)
knowledgeRoutes.get("/health-score", async (c) => {
  const tenantId = c.get("tenantId");
  const projectIdParam = c.req.query("project_id");
  if (!projectIdParam) return c.json({ error: "project_id required" }, 400);

  const projectId = parseProjectId(projectIdParam);
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  try {
    const db = await getTenantDb(tenantId);
    const { computeHealthScore } = await import("../../src/outcomes/value-metrics.js");
    const score = await computeHealthScore(db, projectId);
    return c.json(score);
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /metrics/roi — Context ROI metrics
knowledgeRoutes.get("/metrics/roi", async (c) => {
  const tenantId = c.get("tenantId");
  const projectIdParam = c.req.query("project_id");
  if (!projectIdParam) return c.json({ error: "project_id required" }, 400);

  const projectId = parseProjectId(projectIdParam);
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  try {
    const db = await getTenantDb(tenantId);
    const { computeRoiMetrics } = await import("../../src/outcomes/value-metrics.js");
    const monthStart = c.req.query("month_start");
    const metrics = await computeRoiMetrics(db, projectId, monthStart ?? undefined);
    return c.json(metrics);
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================================================
// Health Score History (v6 polish)
// ============================================================================

knowledgeRoutes.get("/health-score/history", async (c) => {
  const tenantId = c.get("tenantId");
  const projectIdParam = c.req.query("project_id");
  if (!projectIdParam) return c.json({ error: "project_id required" }, 400);

  const projectId = parseProjectId(projectIdParam);
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "30", 10) || 30, 1), 90);

  try {
    const db = await getTenantDb(tenantId);
    const history = await safeAll<{ score: number; computed_at: string }>(
      db,
      `SELECT score, computed_at FROM health_score_history WHERE project_id = ? ORDER BY computed_at DESC LIMIT ?`,
      `SELECT 0 as score, '' as computed_at WHERE 0`,
      [projectId, limit],
    );
    return c.json({ history });
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================================================
// Project Briefing (v6 polish)
// ============================================================================

knowledgeRoutes.get("/projects/:id/briefing", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const tenantId = c.get("tenantId");
  const refresh = c.req.query("refresh") === "true";

  try {
    const db = await getTenantDb(tenantId);
    const { generateOnboardingContext, formatOnboardingContext } = await import(
      "../../src/team/onboarding.js"
    );
    const context = await generateOnboardingContext(db, projectId, refresh);
    const briefing = formatOnboardingContext(context);
    return c.json({
      briefing,
      generatedAt: context.generatedAt,
      sections: context.sections,
    });
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================================================
// Archived Knowledge (v6 polish)
// ============================================================================

knowledgeRoutes.get("/projects/:id/archived", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const archived = await safeAll<{
      id: number;
      source_table: string;
      source_id: number;
      title: string;
      content: string | null;
      reason: string | null;
      archived_at: string;
    }>(
      db,
      `SELECT id, source_table, source_id, title, content, reason, archived_at
       FROM archived_knowledge WHERE project_id = ?
       ORDER BY archived_at DESC LIMIT 100`,
      `SELECT 0 as id, '' as source_table, 0 as source_id, '' as title, NULL as content, NULL as reason, '' as archived_at WHERE 0`,
      [projectId],
    );
    return c.json({ archived });
  } catch (e) {
    console.error("Knowledge API error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

knowledgeRoutes.post("/projects/:id/archived/:archivedId/restore", async (c) => {
  const projectId = parseProjectId(c.req.param("id"));
  if (!projectId) return c.json({ error: "Invalid project ID" }, 400);

  const archivedId = parseInt(c.req.param("archivedId"), 10);
  if (!Number.isFinite(archivedId) || archivedId <= 0) {
    return c.json({ error: "Invalid archived ID" }, 400);
  }

  const tenantId = c.get("tenantId");
  try {
    const db = await getTenantDb(tenantId);
    const { restoreArchivedItem } = await import(
      "../../src/outcomes/knowledge-archiver.js"
    );
    await restoreArchivedItem(db, projectId, archivedId);
    return c.json({ restored: true });
  } catch (e) {
    console.error("Knowledge API error:", e);
    const msg = e instanceof Error ? e.message : "Internal server error";
    return c.json({ error: msg }, msg === "Archived item not found" ? 404 : 500);
  }
});

// ============================================================================
// Memory Export (Wave 3H)
// ============================================================================

knowledgeRoutes.get("/export/memory", async (c) => {
  const tenantId = c.get("tenantId");
  const projectId = Number(c.req.query("projectId"));
  if (!projectId || isNaN(projectId)) {
    return c.json({ error: "projectId required" }, 400);
  }

  try {
    const db = await getTenantDb(tenantId);
    const { exportMemory } = await import("../../src/outcomes/knowledge-archiver.js");
    const exported = await exportMemory(db, projectId);
    return c.json(exported);
  } catch (e) {
    console.error("Knowledge export error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================================================
// Risk Alerts (Wave 3I)
// ============================================================================

knowledgeRoutes.get("/risk-alerts", async (c) => {
  const tenantId = c.get("tenantId");
  const projectId = Number(c.req.query("projectId"));
  if (!projectId || isNaN(projectId)) {
    return c.json({ error: "projectId required" }, 400);
  }

  try {
    const db = await getTenantDb(tenantId);
    const alerts = await safeAll<{
      id: number;
      alert_type: string;
      severity: string;
      title: string;
      details: string | null;
      source_file: string | null;
      created_at: string;
    }>(
      db,
      `SELECT id, alert_type, severity, title, details, source_file, created_at
       FROM risk_alerts WHERE project_id = ? AND dismissed = 0
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
       LIMIT 20`,
      `SELECT 0 as id, '' as alert_type, '' as severity, '' as title, NULL as details, NULL as source_file, '' as created_at WHERE 0`,
      [projectId],
    );
    return c.json({ alerts });
  } catch (e) {
    console.error("Risk alerts error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { knowledgeRoutes };
