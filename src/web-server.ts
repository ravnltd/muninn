/**
 * Muninn Dashboard Server
 * Hono-based API serving project data + static dashboard assets
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";
import { z } from "zod";

// ============================================================================
// Static File Serving Helper
// ============================================================================
// IMPORTANT: Hono + Bun requires explicit Content-Length when returning raw Response.
// Using Bun.file().text() or passing Bun.file directly results in 0-byte responses.
// Always use arrayBuffer() and set Content-Length explicitly.

interface ServeFileOptions {
  contentType: string;
  cache?: "immutable" | "no-cache";
}

async function serveStaticFile(filePath: string, options: ServeFileOptions): Promise<Response | null> {
  if (!existsSync(filePath)) return null;

  const file = Bun.file(filePath);
  const content = await file.arrayBuffer();
  const cacheControl =
    options.cache === "immutable" ? "public, max-age=31536000, immutable" : "no-cache, no-store, must-revalidate";

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": options.contentType,
      "Content-Length": String(content.byteLength),
      "Cache-Control": cacheControl,
      ...(options.cache === "no-cache" && { Pragma: "no-cache", Expires: "0" }),
    },
  });
}

// ============================================================================
// API Input Schemas
// ============================================================================

// Path/Query param schemas
const ProjectIdParam = z.coerce.number().int().positive();
const IssueIdParam = z.coerce.number().int().positive();
const SearchQuery = z.string().min(1).max(500);

// Helper to validate path params
function parseProjectId(id: string): number | null {
  const result = ProjectIdParam.safeParse(id);
  return result.success ? result.data : null;
}

/**
 * Escape FTS5 special characters to prevent query injection.
 * FTS5 operators: AND, OR, NOT, NEAR, *, ", ^
 */
function escapeFtsQuery(query: string): string {
  const sanitized = query
    .replace(/["*^]/g, " ")
    .trim()
    .slice(0, 200);

  if (!sanitized) return '""';

  return sanitized
    .split(/\s+/)
    .filter((term) => !["OR", "AND", "NOT", "NEAR"].includes(term.toUpperCase()))
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" ");
}

// Write operation schemas with input length limits
const CreateIssueInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  type: z.enum(["bug", "tech-debt", "enhancement", "question", "potential"]).default("bug"),
  severity: z.number().int().min(1).max(10).default(5),
  workaround: z.string().max(5000).optional(),
});

const ResolveIssueInput = z.object({
  resolution: z.string().min(1).max(5000),
});

const CreateDecisionInput = z.object({
  title: z.string().min(1).max(500),
  decision: z.string().min(1).max(10000),
  reasoning: z.string().max(10000).optional(),
});

const CreateLearningInput = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(10000),
  category: z.enum(["pattern", "gotcha", "preference", "convention", "architecture"]).default("pattern"),
  context: z.string().max(5000).optional(),
});

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

function openDb(path: string, readonly = true): Database {
  // Bun's Database only accepts readonly option when true
  const db = readonly ? new Database(path, { readonly: true }) : new Database(path);
  // Only set WAL mode on writable databases
  if (!readonly) {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec("PRAGMA busy_timeout = 3000");
  return db;
}

// ============================================================================
// Schema-tolerant query helper
// ============================================================================

type SQLParam = string | number | boolean | null | Uint8Array;

function safeQuery<T>(db: Database, query: string, fallbackQuery: string, params: SQLParam[]): T[] {
  try {
    return db.query(query).all(...params) as T[];
  } catch {
    return db.query(fallbackQuery).all(...params) as T[];
  }
}

function safeQueryGet<T>(db: Database, query: string, fallbackQuery: string, params: SQLParam[]): T | null {
  try {
    return db.query(query).get(...params) as T | null;
  } catch {
    return db.query(fallbackQuery).get(...params) as T | null;
  }
}

// ============================================================================
// App Setup
// ============================================================================

export function createApp(dbPath?: string): Hono {
  const app = new Hono();

  // Security headers
  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    })
  );

  // CORS: Restrict to localhost origins only
  app.use(
    "/*",
    cors({
      origin: (origin) => {
        // Allow same-origin requests (no Origin header)
        if (!origin) return "*";
        // Only allow localhost/127.0.0.1 origins
        const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
        return localhostPattern.test(origin) ? origin : "";
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    })
  );

  // Rate limiting for write endpoints (30 requests per minute)
  // NOTE: x-forwarded-for can be spoofed. In production, use a trusted proxy that sets
  // this header. For local development, "localhost" fallback is acceptable.
  const writeRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (c) => c.req.header("x-forwarded-for") ?? "localhost",
    message: { error: "Too many write requests, please slow down" },
    standardHeaders: "draft-7",
  });

  // Rate limiting for read endpoints (200 requests per minute)
  const readRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 200,
    keyGenerator: (c) => c.req.header("x-forwarded-for") ?? "localhost",
    message: { error: "Too many requests" },
    standardHeaders: "draft-7",
  });

  // Apply rate limiting to API routes
  app.use("/api/*", readRateLimiter);

  // Global DB for project listing
  function getGlobalDb(): Database {
    return openDb(dbPath || getGlobalDbPath());
  }

  // Look up project path and return its DB with the correct local project ID
  function getDbForProject(
    projectId: number,
    readonly = true
  ): { db: Database; project: Record<string, unknown>; localProjectId: number } | null {
    const globalDb = getGlobalDb();
    try {
      const project = globalDb.query(`SELECT * FROM projects WHERE id = ?`).get(projectId) as Record<
        string,
        unknown
      > | null;
      if (!project) {
        globalDb.close();
        return null;
      }
      const projectPath = project.path as string;
      const projectDbPath = getProjectDbPath(projectPath);
      if (projectDbPath) {
        globalDb.close();
        const db = openDb(projectDbPath, readonly);
        // Find the local project ID by path
        const localProject = db
          .query<{ id: number }, [string]>(`SELECT id FROM projects WHERE path = ?`)
          .get(projectPath);
        return { db, project, localProjectId: localProject?.id ?? 1 };
      }
      return { db: globalDb, project, localProjectId: projectId };
    } catch (e) {
      console.error("getDbForProject error:", e);
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
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, project, localProjectId } = result;
    try {
      const fileCount =
        db
          .query<{ count: number }, [number]>(`SELECT COUNT(*) as count FROM files WHERE project_id = ?`)
          .get(localProjectId)?.count ?? 0;

      const openIssues =
        db
          .query<{ count: number }, [number]>(
            `SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND status = 'open'`
          )
          .get(localProjectId)?.count ?? 0;

      const activeDecisions =
        db
          .query<{ count: number }, [number]>(
            `SELECT COUNT(*) as count FROM decisions WHERE project_id = ? AND status = 'active'`
          )
          .get(localProjectId)?.count ?? 0;

      const fragileFiles = safeQuery(
        db,
        `SELECT id, path, purpose, fragility, temperature, velocity_score FROM files WHERE project_id = ? AND fragility >= 5 ORDER BY fragility DESC LIMIT 10`,
        `SELECT id, path, purpose, fragility, NULL as temperature, NULL as velocity_score FROM files WHERE project_id = ? AND fragility >= 5 ORDER BY fragility DESC LIMIT 10`,
        [localProjectId]
      );

      const recentSessions = safeQuery(
        db,
        `SELECT id, goal, outcome, started_at, ended_at, success, session_number FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 10`,
        `SELECT id, goal, outcome, started_at, ended_at, success, NULL as session_number FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 10`,
        [localProjectId]
      );

      const techDebtScore =
        safeQueryGet<{ count: number }>(
          db,
          `SELECT COUNT(*) as count FROM issues WHERE project_id = ? AND type = 'tech-debt' AND status = 'open'`,
          `SELECT 0 as count`,
          [localProjectId]
        )?.count ?? 0;

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
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    // Pagination with parameterized LIMIT/OFFSET
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 500, 1), 500) : 500;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    try {
      const files = safeQuery(
        db,
        `SELECT id, path, purpose, fragility, temperature, archived_at, velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?`,
        `SELECT id, path, purpose, fragility, NULL as temperature, NULL as archived_at, NULL as velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?`,
        [localProjectId, limit, offset]
      );
      return c.json(files);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/decisions", (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    // Pagination with parameterized LIMIT/OFFSET
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 500, 1), 500) : 500;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    try {
      const decisions = safeQuery(
        db,
        `SELECT id, title, decision, status, temperature, archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        `SELECT id, title, decision, status, NULL as temperature, NULL as archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [localProjectId, limit, offset]
      );
      return c.json(decisions);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/issues", (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    // Pagination with parameterized LIMIT/OFFSET
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 500, 1), 500) : 500;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    try {
      const issues = safeQuery(
        db,
        `SELECT id, title, description, severity, status, type, temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?`,
        `SELECT id, title, description, severity, status, NULL as type, NULL as temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?`,
        [localProjectId, limit, offset]
      );
      return c.json(issues);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/learnings", (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    // Pagination with parameterized LIMIT/OFFSET
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 500, 1), 500) : 500;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    try {
      const learnings = safeQuery(
        db,
        `SELECT id, title, content, category, temperature, archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        `SELECT id, title, content, NULL as category, NULL as temperature, NULL as archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [localProjectId, limit, offset]
      );
      return c.json(learnings);
    } finally {
      db.close();
    }
  });

  // Batched memory endpoint - returns files, decisions, issues, learnings in one call
  app.get("/api/projects/:id/memory", (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    // Parse pagination params with defaults
    const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    try {
      const files = safeQuery(
        db,
        `SELECT id, path, purpose, fragility, temperature, archived_at, velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?`,
        `SELECT id, path, purpose, fragility, NULL as temperature, NULL as archived_at, NULL as velocity_score FROM files WHERE project_id = ? ORDER BY fragility DESC, path LIMIT ? OFFSET ?`,
        [localProjectId, limit, offset]
      );

      const decisions = safeQuery(
        db,
        `SELECT id, title, decision, status, temperature, archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        `SELECT id, title, decision, status, NULL as temperature, NULL as archived_at, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [localProjectId, limit, offset]
      );

      const issues = safeQuery(
        db,
        `SELECT id, title, description, severity, status, type, temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?`,
        `SELECT id, title, description, severity, status, NULL as type, NULL as temperature, created_at FROM issues WHERE project_id = ? ORDER BY severity DESC, created_at DESC LIMIT ? OFFSET ?`,
        [localProjectId, limit, offset]
      );

      const learnings = safeQuery(
        db,
        `SELECT id, title, content, category, temperature, archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        `SELECT id, title, content, NULL as category, NULL as temperature, NULL as archived_at, created_at FROM learnings WHERE (project_id = ? OR project_id IS NULL) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [localProjectId, limit, offset]
      );

      return c.json({ files, decisions, issues, learnings });
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/sessions", (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;
    try {
      const sessions = safeQuery(
        db,
        `SELECT id, goal, outcome, started_at, ended_at, success, session_number, files_touched FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`,
        `SELECT id, goal, outcome, started_at, ended_at, success, NULL as session_number, files_touched FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`,
        [localProjectId]
      );
      return c.json(sessions);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/relationships", (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId: pid } = result;
    try {
      const relationships = db
        .query(`
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
      `)
        .all(pid, pid, pid, pid, pid, pid, pid, pid);
      return c.json(relationships);
    } finally {
      db.close();
    }
  });

  app.get("/api/projects/:id/graph", (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;
    try {
      const nodes: Array<{ id: string; type: string; label: string; size: number; temperature?: string }> = [];

      const files = db
        .query<{ id: number; path: string; fragility: number; temperature: string | null }, [number]>(
          `SELECT id, path, fragility, temperature FROM files WHERE project_id = ? AND archived_at IS NULL`
        )
        .all(localProjectId);
      for (const f of files) {
        nodes.push({
          id: `file:${f.id}`,
          type: "file",
          label: f.path,
          size: Math.max(6, f.fragility),
          temperature: f.temperature ?? undefined,
        });
      }

      const decisions = db
        .query<{ id: number; title: string; temperature: string | null }, [number]>(
          `SELECT id, title, temperature FROM decisions WHERE project_id = ? AND archived_at IS NULL`
        )
        .all(localProjectId);
      for (const d of decisions) {
        nodes.push({
          id: `decision:${d.id}`,
          type: "decision",
          label: d.title,
          size: 8,
          temperature: d.temperature ?? undefined,
        });
      }

      const learnings = db
        .query<{ id: number; title: string; temperature: string | null }, [number]>(
          `SELECT id, title, temperature FROM learnings WHERE (project_id = ? OR project_id IS NULL) AND archived_at IS NULL`
        )
        .all(localProjectId);
      for (const l of learnings) {
        nodes.push({
          id: `learning:${l.id}`,
          type: "learning",
          label: l.title,
          size: 6,
          temperature: l.temperature ?? undefined,
        });
      }

      const issues = db
        .query<{ id: number; title: string; severity: number; temperature: string | null }, [number]>(
          `SELECT id, title, severity, temperature FROM issues WHERE project_id = ? AND archived_at IS NULL`
        )
        .all(localProjectId);
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
      const relationships = db
        .query<
          {
            source_type: string;
            source_id: number;
            target_type: string;
            target_id: number;
            relationship: string;
            strength: number;
          },
          []
        >(`SELECT source_type, source_id, target_type, target_id, relationship, strength FROM relationships`)
        .all();

      const edges = relationships
        .map((r) => ({
          source: `${r.source_type}:${r.source_id}`,
          target: `${r.target_type}:${r.target_id}`,
          type: r.relationship,
          strength: r.strength,
        }))
        .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

      return c.json({ nodes, edges });
    } finally {
      db.close();
    }
  });

  app.get("/api/search", (c) => {
    const queryResult = SearchQuery.safeParse(c.req.query("q"));
    if (!queryResult.success) return c.json([]);
    const query = queryResult.data;

    const projectId = parseProjectId(c.req.query("project_id") || "");
    if (!projectId) return c.json([]);

    const result = getDbForProject(projectId);
    if (!result) return c.json([]);
    const { db, localProjectId } = result;

    // Escape FTS5 query to prevent injection
    const safeQuery = escapeFtsQuery(query);
    if (!safeQuery || safeQuery === '""') return c.json([]);

    try {
      const files = db
        .query(`
        SELECT f.id, 'file' as type, f.path as title, f.purpose as content
        FROM fts_files JOIN files f ON fts_files.rowid = f.id
        WHERE fts_files MATCH ? AND f.project_id = ? AND f.archived_at IS NULL
        LIMIT 5
      `)
        .all(safeQuery, localProjectId);
      return c.json(files);
    } finally {
      db.close();
    }
  });

  // ============================================================================
  // Write API Routes (POST/PUT) - with stricter rate limiting
  // ============================================================================

  // Create Issue
  app.post("/api/projects/:id/issues", writeRateLimiter, async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId, false);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    try {
      const body = await c.req.json();
      const input = CreateIssueInput.parse(body);

      const stmt = db.query(`
        INSERT INTO issues (project_id, title, description, type, severity, status, workaround, created_at)
        VALUES (?, ?, ?, ?, ?, 'open', ?, datetime('now'))
      `);
      stmt.run(
        localProjectId,
        input.title,
        input.description ?? null,
        input.type,
        input.severity,
        input.workaround ?? null
      );

      const id = db.query<{ id: number }, []>(`SELECT last_insert_rowid() as id`).get()?.id;
      return c.json({ id, message: "Issue created" }, 201);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: e.errors }, 400);
      }
      // Log full error internally, return generic message to client
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    } finally {
      db.close();
    }
  });

  // Resolve Issue
  app.put("/api/projects/:id/issues/:issueId/resolve", writeRateLimiter, async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const issueId = IssueIdParam.safeParse(c.req.param("issueId"));
    if (!issueId.success) return c.json({ error: "Invalid issue ID" }, 400);
    const result = getDbForProject(projectId, false);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    try {
      const body = await c.req.json();
      const input = ResolveIssueInput.parse(body);

      // Verify issue exists and belongs to this project
      const issue = db
        .query<{ id: number }, [number, number]>(`SELECT id FROM issues WHERE id = ? AND project_id = ?`)
        .get(issueId.data, localProjectId);
      if (!issue) return c.json({ error: "Issue not found" }, 404);

      db.query(`
        UPDATE issues SET status = 'resolved', resolution = ?, resolved_at = datetime('now')
        WHERE id = ?
      `).run(input.resolution, issueId.data);

      return c.json({ message: "Issue resolved" });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: e.errors }, 400);
      }
      // Log full error internally, return generic message to client
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    } finally {
      db.close();
    }
  });

  // Create Decision
  app.post("/api/projects/:id/decisions", writeRateLimiter, async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId, false);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    try {
      const body = await c.req.json();
      const input = CreateDecisionInput.parse(body);

      const stmt = db.query(`
        INSERT INTO decisions (project_id, title, decision, reasoning, status, created_at)
        VALUES (?, ?, ?, ?, 'active', datetime('now'))
      `);
      stmt.run(localProjectId, input.title, input.decision, input.reasoning ?? null);

      const id = db.query<{ id: number }, []>(`SELECT last_insert_rowid() as id`).get()?.id;
      return c.json({ id, message: "Decision created" }, 201);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: e.errors }, 400);
      }
      // Log full error internally, return generic message to client
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    } finally {
      db.close();
    }
  });

  // Create Learning
  app.post("/api/projects/:id/learnings", writeRateLimiter, async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = getDbForProject(projectId, false);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { db, localProjectId } = result;

    try {
      const body = await c.req.json();
      const input = CreateLearningInput.parse(body);

      const stmt = db.query(`
        INSERT INTO learnings (project_id, title, content, category, context, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);
      stmt.run(localProjectId, input.title, input.content, input.category, input.context ?? null);

      const id = db.query<{ id: number }, []>(`SELECT last_insert_rowid() as id`).get()?.id;
      return c.json({ id, message: "Learning created" }, 201);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: e.errors }, 400);
      }
      // Log full error internally, return generic message to client
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    } finally {
      db.close();
    }
  });

  // ============================================================================
  // Static Assets (built Svelte dashboard)
  // ============================================================================

  const dashboardDist = join(import.meta.dir, "..", "dashboard-dist");

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
    if (!filePath.startsWith(`${assetsDir}/`) && filePath !== assetsDir) {
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
  app.get("*", async (c) => {
    const indexPath = join(dashboardDist, "index.html");
    const response = await serveStaticFile(indexPath, { contentType: "text/html; charset=utf-8", cache: "no-cache" });
    return response ?? c.text("Dashboard not built. Run: cd src/dashboard && bun run build", 404);
  });

  return app;
}

// ============================================================================
// Startup Health Check
// ============================================================================

async function verifyStaticServing(port: number): Promise<void> {
  // Verify index.html serves with content
  const indexRes = await fetch(`http://localhost:${port}/`);
  const contentLength = indexRes.headers.get("content-length");

  if (contentLength === "0" || contentLength === null) {
    console.error(`FATAL: Static file serving broken - index.html has content-length: ${contentLength}`);
    console.error("This is the Hono+Bun bug. Check serveStaticFile() uses arrayBuffer().");
    process.exit(1);
  }

  // Verify body is not empty
  const body = await indexRes.text();
  if (body.length === 0) {
    console.error("FATAL: Static file serving broken - index.html body is empty");
    process.exit(1);
  }

  console.log(`Health check passed: index.html serves ${contentLength} bytes`);
}

// ============================================================================
// Standalone Entry
// ============================================================================

if (import.meta.main) {
  const port = parseInt(process.argv[2] || "3334", 10);
  const app = createApp();

  Bun.serve({
    fetch: app.fetch,
    port,
  });

  console.log(`Muninn Dashboard: http://localhost:${port}`);

  // Run health check after server starts
  verifyStaticServing(port).catch((err) => {
    console.error("Health check failed:", err.message);
    process.exit(1);
  });
}

export default createApp;
