/**
 * Muninn Dashboard Server
 * Hono-based API serving project data + static dashboard assets
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { Database } from "bun:sqlite";
import { join } from "path";
import { existsSync } from "fs";

// ============================================================================
// Database Connection
// ============================================================================

function getGlobalDbPath(): string {
  return join(process.env.HOME || "~", ".claude", "memory.db");
}

function getProjectDbPath(projectPath: string): string | null {
  const projectDb = join(projectPath, ".claude", "memory.db");
  if (existsSync(projectDb)) return projectDb;
  return null;
}

function openDb(path: string): Database {
  const db = new Database(path, { readonly: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 3000");
  return db;
}

// ============================================================================
// App Setup
// ============================================================================

export function createApp(dbPath?: string): Hono {
  const app = new Hono();

  app.use("/*", cors());

  // Global DB for project listing
  function getGlobalDb(): Database {
    return openDb(dbPath || getGlobalDbPath());
  }

  // Project-specific DB for detail queries
  function getProjectDb(projectPath: string): Database {
    const projectDbPath = getProjectDbPath(projectPath);
    if (projectDbPath) return openDb(projectDbPath);
    // Fall back to global DB if no project-local DB
    return getGlobalDb();
  }

  // Look up project path and return its DB with the correct local project ID
  function getDbForProject(projectId: number): { db: Database; project: Record<string, unknown>; localProjectId: number } | null {
    const globalDb = getGlobalDb();
    try {
      const project = globalDb.query(`SELECT * FROM projects WHERE id = ?`).get(projectId) as Record<string, unknown> | null;
      if (!project) return null;
      const projectPath = project.path as string;
      const projectDbPath = getProjectDbPath(projectPath);
      if (projectDbPath) {
        globalDb.close();
        const db = openDb(projectDbPath);
        // Find the local project ID by path
        const localProject = db.query<{ id: number }, [string]>(
          `SELECT id FROM projects WHERE path = ?`
        ).get(projectPath);
        return { db, project, localProjectId: localProject?.id ?? 1 };
      }
      return { db: globalDb, project, localProjectId: projectId };
    } catch {
      globalDb.close();
      return null;
    }
  }

  // ============================================================================
  // API Routes
  // ============================================================================

  app.get("/api/projects", (c) => {
    const db = getGlobalDb();
    try {
      const projects = db.query(`SELECT id, name, path, status, mode FROM projects ORDER BY updated_at DESC`).all();
      return c.json(projects);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/health", (c) => {
    const projectId = parseInt(c.req.param("id"), 10);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, project, localProjectId } = result;
    try {

      const fileCount = db.query<{ count: number }, [number]>(
        `SELECT COUNT(*) as count FROM files WHERE project_id = ?`
      ).get(localProjectId)?.count ?? 0;

      const openIssues = db.query<{ count: number }, [number]>(
        `SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND status = 'open'`
      ).get(localProjectId)?.count ?? 0;

      const activeDecisions = db.query<{ count: number }, [number]>(
        `SELECT COUNT(*) as count FROM decisions WHERE project_id = ? AND status = 'active'`
      ).get(localProjectId)?.count ?? 0;

      const fragileFiles = db.query(
        `SELECT id, path, purpose, fragility, temperature, velocity_score FROM files WHERE project_id = ? AND fragility >= 5 ORDER BY fragility DESC LIMIT 10`
      ).all(localProjectId);

      const recentSessions = db.query(
        `SELECT id, goal, outcome, started_at, ended_at, success, session_number FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 10`
      ).all(localProjectId);

      const techDebtScore = db.query<{ count: number }, [number]>(
        `SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND type = 'tech-debt' AND status = 'open'`
      ).get(localProjectId)?.count ?? 0;

      return c.json({
        project,
        fileCount,
        openIssues,
        activeDecisions,
        fragileFiles,
        recentSessions,
        techDebtScore: Math.min(techDebtScore * 10, 100),
      });
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/files", (c) => {
    const projectId = parseInt(c.req.param("id"), 10);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;
    try {
      const files = db.query(
        `SELECT id, path, purpose, fragility, temperature, archived_at, velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path`
      ).all(localProjectId);
      return c.json(files);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/decisions", (c) => {
    const projectId = parseInt(c.req.param("id"), 10);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;
    try {
      const decisions = db.query(
        `SELECT id, title, decision, status, temperature, archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC`
      ).all(localProjectId);
      return c.json(decisions);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/issues", (c) => {
    const projectId = parseInt(c.req.param("id"), 10);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;
    try {
      const issues = db.query(
        `SELECT id, title, description, severity, status, type, temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC`
      ).all(localProjectId);
      return c.json(issues);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/learnings", (c) => {
    const projectId = parseInt(c.req.param("id"), 10);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;
    try {
      const learnings = db.query(
        `SELECT id, title, content, category, temperature, archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC`
      ).all(localProjectId);
      return c.json(learnings);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/sessions", (c) => {
    const projectId = parseInt(c.req.param("id"), 10);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;
    try {
      const sessions = db.query(
        `SELECT id, goal, outcome, started_at, ended_at, success, session_number, files_touched FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`
      ).all(localProjectId);
      return c.json(sessions);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/relationships", (c) => {
    const projectId = parseInt(c.req.param("id"), 10);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId: pid } = result;
    try {
      const relationships = db.query(`
        SELECT r.* FROM relationships r
        WHERE (r.source_type = 'file' AND r.source_id IN (SELECT id FROM files WHERE project_id = ?))
           OR (r.target_type = 'file' AND r.target_id IN (SELECT id FROM files WHERE project_id = ?))
           OR (r.source_type = 'decision' AND r.source_id IN (SELECT id FROM decisions WHERE project_id = ?))
           OR (r.target_type = 'decision' AND r.target_id IN (SELECT id FROM decisions WHERE project_id = ?))
           OR (r.source_type = 'issue' AND r.source_id IN (SELECT id FROM issues WHERE project_id = ?))
           OR (r.target_type = 'issue' AND r.target_id IN (SELECT id FROM issues WHERE project_id = ?))
           OR (r.source_type = 'learning' AND r.source_id IN (SELECT id FROM learnings WHERE project_id = ?))
           OR (r.target_type = 'learning' AND r.target_id IN (SELECT id FROM learnings WHERE project_id = ?))
        ORDER BY r.strength DESC
      `).all(pid, pid, pid, pid, pid, pid, pid, pid);
      return c.json(relationships);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/graph", (c) => {
    const projectId = parseInt(c.req.param("id"), 10);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;
    try {
      const nodes: Array<{ id: string; type: string; label: string; size: number; temperature?: string }> = [];

      const files = db.query<{ id: number; path: string; fragility: number; temperature: string | null }, [number]>(
        `SELECT id, path, fragility, temperature FROM files WHERE project_id = ? AND archived_at IS NULL`
      ).all(localProjectId);
      for (const f of files) {
        nodes.push({ id: `file:${f.id}`, type: "file", label: f.path, size: Math.max(6, f.fragility), temperature: f.temperature ?? undefined });
      }

      const decisions = db.query<{ id: number; title: string; temperature: string | null }, [number]>(
        `SELECT id, title, temperature FROM decisions WHERE project_id = ? AND archived_at IS NULL`
      ).all(localProjectId);
      for (const d of decisions) {
        nodes.push({ id: `decision:${d.id}`, type: "decision", label: d.title, size: 8, temperature: d.temperature ?? undefined });
      }

      const learnings = db.query<{ id: number; title: string; temperature: string | null }, [number]>(
        `SELECT id, title, temperature FROM learnings WHERE (project_id = ? OR project_id IS NULL) AND archived_at IS NULL`
      ).all(localProjectId);
      for (const l of learnings) {
        nodes.push({ id: `learning:${l.id}`, type: "learning", label: l.title, size: 6, temperature: l.temperature ?? undefined });
      }

      const issues = db.query<{ id: number; title: string; severity: number; temperature: string | null }, [number]>(
        `SELECT id, title, severity, temperature FROM issues WHERE project_id = ? AND archived_at IS NULL`
      ).all(localProjectId);
      for (const i of issues) {
        nodes.push({ id: `issue:${i.id}`, type: "issue", label: i.title, size: Math.max(6, i.severity), temperature: i.temperature ?? undefined });
      }

      // Build edges from relationships
      const nodeIds = new Set(nodes.map(n => n.id));
      const relationships = db.query<{ source_type: string; source_id: number; target_type: string; target_id: number; relationship: string; strength: number }, []>(
        `SELECT source_type, source_id, target_type, target_id, relationship, strength FROM relationships`
      ).all();

      const edges = relationships
        .map(r => ({
          source: `${r.source_type}:${r.source_id}`,
          target: `${r.target_type}:${r.target_id}`,
          type: r.relationship,
          strength: r.strength,
        }))
        .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

      return c.json({ nodes, edges });
    } finally {
      db.close();
    }
  });

  app.get("/api/search", (c) => {
    const query = c.req.query("q") || "";
    const projectIdStr = c.req.query("project_id");
    const projectId = projectIdStr ? parseInt(projectIdStr, 10) : undefined;

    if (!query) return c.json([]);

    if (!projectId) return c.json([]);

    const result = getDbForProject(projectId);
    if (!result) return c.json([]);
    const { db, localProjectId } = result;

    try {
      const files = db.query(`
        SELECT f.id, 'file' as type, f.path as title, f.purpose as content
        FROM fts_files JOIN files f ON fts_files.rowid = f.id
        WHERE fts_files MATCH ? AND f.project_id = ? AND f.archived_at IS NULL
        LIMIT 5
      `).all(query, localProjectId);
      return c.json(files);
    } finally {
      db.close();
    }
  });

  // ============================================================================
  // Static Assets (built Svelte dashboard)
  // ============================================================================

  const dashboardDist = join(import.meta.dir, "..", "dashboard-dist");

  // Serve static assets directly with Bun.file for reliability
  app.get("/assets/:filename", async (c) => {
    const filename = c.req.param("filename");
    const filePath = join(dashboardDist, "assets", filename);
    if (!existsSync(filePath)) return c.notFound();
    const file = Bun.file(filePath);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    if (filename.endsWith(".js")) c.header("Content-Type", "text/javascript; charset=utf-8");
    else if (filename.endsWith(".css")) c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(await file.arrayBuffer());
  });

  // SPA fallback — never cache index.html
  app.get("*", async (c) => {
    const indexPath = join(dashboardDist, "index.html");
    if (existsSync(indexPath)) {
      c.header("Cache-Control", "no-cache, no-store, must-revalidate");
      const html = await Bun.file(indexPath).text();
      return c.html(html);
    }
    return c.text("Dashboard not built. Run: cd src/dashboard && bun run build", 404);
  });

  return app;
}

// ============================================================================
// Standalone Entry
// ============================================================================

if (import.meta.main) {
  const port = parseInt(process.argv[2] || "3334", 10);
  const app = createApp();

  console.log(`Muninn Dashboard: http://localhost:${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
  });
}

export default createApp;
