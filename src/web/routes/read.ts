/**
 * Read-only GET routes for the dashboard API + static asset serving.
 */

import { join, resolve } from "node:path";
import type { Hono } from "hono";
import type { DatabaseAdapter } from "../../database/adapter";
import { parseProjectId, SearchQuery, escapeFtsQuery } from "../schemas";
import { safeAll, safeGet } from "../db-helpers";
import { serveStaticFile } from "../static";

export interface ReadRouteDeps {
  getDb: () => Promise<DatabaseAdapter>;
  resolveProject: (
    projectId: number,
  ) => Promise<{ adapter: DatabaseAdapter; project: Record<string, unknown>; localProjectId: number } | null>;
}

export function registerReadRoutes(app: Hono, deps: ReadRouteDeps): void {
  const { getDb, resolveProject } = deps;

  // ============================================================================
  // API Routes
  // ============================================================================

  app.get("/api/projects", async (c) => {
    try {
      const db = await getDb();
      const projects = await db.all(
        "SELECT id, name, path, status, mode FROM projects ORDER BY updated_at DESC",
      );
      return c.json(projects);
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/projects/:id/health", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, project, localProjectId } = result;

    try {
      const fileCount =
        (await db.get<{ count: number }>(
          "SELECT COUNT(*) as count FROM files WHERE project_id = ?",
          [localProjectId],
        ))?.count ?? 0;

      const openIssues =
        (await db.get<{ count: number }>(
          "SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND status = 'open'",
          [localProjectId],
        ))?.count ?? 0;

      const activeDecisions =
        (await db.get<{ count: number }>(
          "SELECT COUNT(*) as count FROM decisions WHERE project_id = ? AND status = 'active'",
          [localProjectId],
        ))?.count ?? 0;

      const fragileFiles = await safeAll(
        db,
        "SELECT id, path, purpose, fragility, temperature, velocity_score FROM files WHERE project_id = ? AND fragility >= 5 ORDER BY fragility DESC LIMIT 10",
        "SELECT id, path, purpose, fragility, NULL as temperature, NULL as velocity_score FROM files WHERE project_id = ? AND fragility >= 5 ORDER BY fragility DESC LIMIT 10",
        [localProjectId],
      );

      const recentSessions = await safeAll(
        db,
        "SELECT id, goal, outcome, started_at, ended_at, success, session_number FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 10",
        "SELECT id, goal, outcome, started_at, ended_at, success, NULL as session_number FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 10",
        [localProjectId],
      );

      const techDebtScore =
        (await safeGet<{ count: number }>(
          db,
          "SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND type = 'tech-debt' AND status = 'open'",
          "SELECT 0 as count",
          [localProjectId],
        ))?.count ?? 0;

      return c.json({
        project,
        fileCount,
        openIssues,
        activeDecisions,
        fragileFiles,
        recentSessions,
        techDebtScore: Math.min(techDebtScore * 10, 100),
      });
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/projects/:id/files", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    // Pagination with parameterized LIMIT/OFFSET
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 500, 1), 500) : 500;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    try {
      const files = await safeAll(
        db,
        "SELECT id, path, purpose, fragility, temperature, archived_at, velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?",
        "SELECT id, path, purpose, fragility, NULL as temperature, NULL as archived_at, NULL as velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?",
        [localProjectId, limit, offset],
      );
      return c.json(files);
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/projects/:id/decisions", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    // Pagination with parameterized LIMIT/OFFSET
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 500, 1), 500) : 500;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    try {
      const decisions = await safeAll(
        db,
        "SELECT id, title, decision, status, temperature, archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        "SELECT id, title, decision, status, NULL as temperature, NULL as archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [localProjectId, limit, offset],
      );
      return c.json(decisions);
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/projects/:id/issues", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    // Pagination with parameterized LIMIT/OFFSET
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 500, 1), 500) : 500;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    try {
      const issues = await safeAll(
        db,
        "SELECT id, title, description, severity, status, type, temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?",
        "SELECT id, title, description, severity, status, NULL as type, NULL as temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?",
        [localProjectId, limit, offset],
      );
      return c.json(issues);
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/projects/:id/learnings", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    // Pagination with parameterized LIMIT/OFFSET
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 500, 1), 500) : 500;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    try {
      const learnings = await safeAll(
        db,
        "SELECT id, title, content, category, temperature, archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
        "SELECT id, title, content, NULL as category, NULL as temperature, NULL as archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [localProjectId, limit, offset],
      );
      return c.json(learnings);
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // Batched memory endpoint - returns files, decisions, issues, learnings in one call
  app.get("/api/projects/:id/memory", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    // Parse pagination params with defaults
    const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    try {
      const [files, decisions, issues, learnings] = await Promise.all([
        safeAll(
          db,
          "SELECT id, path, purpose, fragility, temperature, archived_at, velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?",
          "SELECT id, path, purpose, fragility, NULL as temperature, NULL as archived_at, NULL as velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?",
          [localProjectId, limit, offset],
        ),
        safeAll(
          db,
          "SELECT id, title, decision, status, temperature, archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
          "SELECT id, title, decision, status, NULL as temperature, NULL as archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
          [localProjectId, limit, offset],
        ),
        safeAll(
          db,
          "SELECT id, title, description, severity, status, type, temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?",
          "SELECT id, title, description, severity, status, NULL as type, NULL as temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?",
          [localProjectId, limit, offset],
        ),
        safeAll(
          db,
          "SELECT id, title, content, category, temperature, archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
          "SELECT id, title, content, NULL as category, NULL as temperature, NULL as archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?",
          [localProjectId, limit, offset],
        ),
      ]);

      return c.json({ files, decisions, issues, learnings });
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/projects/:id/sessions", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    try {
      const sessions = await safeAll(
        db,
        "SELECT id, goal, outcome, started_at, ended_at, success, session_number, files_touched FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50",
        "SELECT id, goal, outcome, started_at, ended_at, success, NULL as session_number, files_touched FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50",
        [localProjectId],
      );
      return c.json(sessions);
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/projects/:id/relationships", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId: pid } = result;

    try {
      const relationships = await db.all(
        `SELECT r.* FROM relationships r
        WHERE (r.source_type = 'file' AND r.source_id IN (SELECT id FROM files WHERE project_id = ?))
           OR (r.target_type = 'file' AND r.target_id IN (SELECT id FROM files WHERE project_id = ?))
           OR (r.source_type = 'decision' AND r.source_id IN (SELECT id FROM decisions WHERE project_id = ?))
           OR (r.target_type = 'decision' AND r.target_id IN (SELECT id FROM decisions WHERE project_id = ?))
           OR (r.source_type = 'issue' AND r.source_id IN (SELECT id FROM issues WHERE project_id = ?))
           OR (r.target_type = 'issue' AND r.target_id IN (SELECT id FROM issues WHERE project_id = ?))
           OR (r.source_type = 'learning' AND r.source_id IN (SELECT id FROM learnings WHERE project_id = ?))
           OR (r.target_type = 'learning' AND r.target_id IN (SELECT id FROM learnings WHERE project_id = ?))
        ORDER BY r.strength DESC`,
        [pid, pid, pid, pid, pid, pid, pid, pid],
      );
      return c.json(relationships);
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/projects/:id/graph", async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    try {
      const nodes: Array<{ id: string; type: string; label: string; size: number; temperature?: string }> = [];

      const files = await db.all<{ id: number; path: string; fragility: number; temperature: string | null }>(
        "SELECT id, path, fragility, temperature FROM files WHERE project_id = ? AND archived_at IS NULL",
        [localProjectId],
      );
      for (const f of files) {
        nodes.push({
          id: `file:${f.id}`,
          type: "file",
          label: f.path,
          size: Math.max(6, f.fragility),
          temperature: f.temperature ?? undefined,
        });
      }

      const decisions = await db.all<{ id: number; title: string; temperature: string | null }>(
        "SELECT id, title, temperature FROM decisions WHERE project_id = ? AND archived_at IS NULL",
        [localProjectId],
      );
      for (const d of decisions) {
        nodes.push({
          id: `decision:${d.id}`,
          type: "decision",
          label: d.title,
          size: 8,
          temperature: d.temperature ?? undefined,
        });
      }

      const learnings = await db.all<{ id: number; title: string; temperature: string | null }>(
        "SELECT id, title, temperature FROM learnings WHERE (project_id = ? OR project_id IS NULL) AND archived_at IS NULL",
        [localProjectId],
      );
      for (const l of learnings) {
        nodes.push({
          id: `learning:${l.id}`,
          type: "learning",
          label: l.title,
          size: 6,
          temperature: l.temperature ?? undefined,
        });
      }

      const issues = await db.all<{ id: number; title: string; severity: number; temperature: string | null }>(
        "SELECT id, title, severity, temperature FROM issues WHERE project_id = ? AND archived_at IS NULL",
        [localProjectId],
      );
      for (const i of issues) {
        nodes.push({
          id: `issue:${i.id}`,
          type: "issue",
          label: i.title,
          size: Math.max(6, i.severity),
          temperature: i.temperature ?? undefined,
        });
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

      const edges = relationships
        .map((r) => ({
          source: `${r.source_type}:${r.source_id}`,
          target: `${r.target_type}:${r.target_id}`,
          type: r.relationship,
          strength: r.strength,
        }))
        .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

      return c.json({ nodes, edges });
    } catch (e) {
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  app.get("/api/search", async (c) => {
    const queryResult = SearchQuery.safeParse(c.req.query("q"));
    if (!queryResult.success) return c.json([]);
    const query = queryResult.data;

    const projectId = parseProjectId(c.req.query("project_id") || "");
    if (!projectId) return c.json([]);

    const result = await resolveProject(projectId);
    if (!result) return c.json([]);
    const { adapter: db, localProjectId } = result;

    // Escape FTS5 query to prevent injection
    const safeFts = escapeFtsQuery(query);
    if (!safeFts || safeFts === '""') return c.json([]);

    try {
      const files = await db.all(
        `SELECT f.id, 'file' as type, f.path as title, f.purpose as content
        FROM fts_files JOIN files f ON fts_files.rowid = f.id
        WHERE fts_files MATCH ? AND f.project_id = ? AND f.archived_at IS NULL
        LIMIT 5`,
        [safeFts, localProjectId],
      );
      return c.json(files);
    } catch (e) {
      console.error("API Error:", e);
      return c.json([]);
    }
  });

  // ============================================================================
  // Static Assets (built Svelte dashboard)
  // ============================================================================

  const dashboardDist = join(import.meta.dir, "..", "..", "..", "dashboard-dist");

  // Serve static assets (JS, CSS) - use helper to ensure correct Content-Length
  app.get("/assets/:filename", async (c) => {
    const filename = c.req.param("filename");

    // Block path traversal attempts
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return c.json({ error: "Invalid filename" }, 400);
    }

    const assetsDir = resolve(dashboardDist, "assets");
    const filePath = resolve(assetsDir, filename);

    // Ensure path is within assets directory
    if (!filePath.startsWith(`${assetsDir}/`)) {
      return c.json({ error: "Invalid path" }, 400);
    }

    const contentType = Bun.file(filePath).type || "application/octet-stream";
    const response = await serveStaticFile(filePath, { contentType, cache: "no-cache" });
    return response ?? c.notFound();
  });

  // Serve favicon
  app.get("/favicon.svg", async (c) => {
    const filePath = join(dashboardDist, "favicon.svg");
    const response = await serveStaticFile(filePath, { contentType: "image/svg+xml", cache: "no-cache" });
    return response ?? c.notFound();
  });

  // SPA fallback — serve index.html for all unmatched routes
  // L2: Log unmatched routes in DEBUG mode for troubleshooting
  app.get("*", async (c) => {
    if (process.env.DEBUG) {
      console.log(`[SPA fallback] Unmatched route: ${c.req.path}`);
    }
    const indexPath = join(dashboardDist, "index.html");
    const response = await serveStaticFile(indexPath, { contentType: "text/html; charset=utf-8", cache: "no-cache" });
    return response ?? c.text("Dashboard not built. Run: cd src/dashboard && bun run build", 404);
  });
}
