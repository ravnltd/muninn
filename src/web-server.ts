/**
 * Muninn Dashboard Server
 * Hono-based API serving project data + static dashboard assets
 *
 * Uses DatabaseAdapter for HTTP/local mode support.
 * In HTTP mode, queries go to the remote sqld server.
 * In local mode, queries use bun:sqlite via LocalAdapter.
 */

import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";
import { z } from "zod";
import type { DatabaseAdapter } from "./database/adapter";
import { getGlobalDb as getGlobalDbAdapter } from "./database/connection";
import { SafePort } from "./mcp-validation.js";

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
// Schema-tolerant query helpers (async, adapter-based)
// ============================================================================

async function safeAll<T>(adapter: DatabaseAdapter, query: string, fallback: string, params: unknown[]): Promise<T[]> {
  try {
    return await adapter.all<T>(query, params);
  } catch {
    return await adapter.all<T>(fallback, params);
  }
}

async function safeGet<T>(
  adapter: DatabaseAdapter,
  query: string,
  fallback: string,
  params: unknown[],
): Promise<T | null> {
  try {
    return await adapter.get<T>(query, params);
  } catch {
    return await adapter.get<T>(fallback, params);
  }
}

// ============================================================================
// Security Helpers
// ============================================================================

/**
 * Get client IP address with configurable proxy trust.
 * Only trusts x-forwarded-for when MUNINN_TRUSTED_PROXY=true.
 */
function getClientIp(c: Context): string {
  if (process.env.MUNINN_TRUSTED_PROXY === "true") {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
  }
  // Fall back to host header (without port) or localhost
  return c.req.header("host")?.split(":")[0] || "localhost";
}

/**
 * Timing-safe token comparison to prevent timing attacks.
 * Returns true if tokens match, false otherwise.
 */
function safeTokenCompare(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  // If lengths differ, still do comparison to prevent length-based timing attacks
  // but always return false
  if (providedBuf.length !== expectedBuf.length) {
    // Compare against itself to maintain constant time
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Check if the request is from localhost based on multiple indicators.
 * More robust than relying solely on Host header which can be spoofed.
 */
function isLocalhostRequest(c: Context): boolean {
  // Check Host header (primary check, but can be spoofed)
  const host = c.req.header("host") || "";
  const hostIsLocal =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:");

  // Check X-Forwarded-For if NOT trusting proxy (absence = likely direct connection)
  // If there's no X-Forwarded-For and host looks local, it's more likely genuine
  const hasForwardedFor = !!c.req.header("x-forwarded-for");

  // In non-proxy mode, X-Forwarded-For presence suggests potential spoofing attempt
  if (process.env.MUNINN_TRUSTED_PROXY !== "true" && hasForwardedFor) {
    return false;
  }

  return hostIsLocal;
}

/**
 * Create token-based authentication middleware.
 * Requires MUNINN_API_TOKEN env var to be set to enable auth.
 * Localhost bypass is enabled by default (MUNINN_LOCALHOST_BYPASS != "false").
 *
 * Security features:
 * - Timing-safe token comparison (prevents timing attacks)
 * - Multi-factor localhost detection (mitigates Host header spoofing)
 * - Minimum token length warning
 */
function createAuthMiddleware() {
  const apiToken = process.env.MUNINN_API_TOKEN;

  // Warn about weak tokens (L3: minimum token length)
  if (apiToken && apiToken.length < 32) {
    console.warn(
      "⚠️  MUNINN_API_TOKEN is less than 32 characters. Consider using a stronger token for security."
    );
  }

  return async (c: Context, next: Next) => {
    // If no token configured, auth is disabled
    if (!apiToken) {
      return next();
    }

    // GET/OPTIONS requests don't require auth (read-only)
    if (c.req.method === "GET" || c.req.method === "OPTIONS") {
      return next();
    }

    // Localhost bypass (enabled by default) - uses multi-factor detection
    if (process.env.MUNINN_LOCALHOST_BYPASS !== "false") {
      if (isLocalhostRequest(c)) {
        return next();
      }
    }

    // Check Bearer token with timing-safe comparison (H4: timing attack fix)
    const authHeader = c.req.header("Authorization") || "";
    const expectedHeader = `Bearer ${apiToken}`;
    if (safeTokenCompare(authHeader, expectedHeader)) {
      return next();
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
}

// ============================================================================
// App Setup
// ============================================================================

/**
 * Create the dashboard Hono app.
 * Accepts an optional DatabaseAdapter for testing/DI.
 * When not provided, uses getGlobalDbAdapter() which auto-detects HTTP/local mode.
 */
export function createApp(adapter?: DatabaseAdapter): Hono {
  const app = new Hono();

  // Lazy-init: resolved on first API request
  let dbAdapter: DatabaseAdapter | null = adapter ?? null;

  async function getDb(): Promise<DatabaseAdapter> {
    if (!dbAdapter) {
      dbAdapter = await getGlobalDbAdapter();
    }
    return dbAdapter;
  }

  // Look up project and return its project_id.
  // In HTTP mode all projects share one DB, so we just verify the project exists.
  async function resolveProject(
    projectId: number,
  ): Promise<{ adapter: DatabaseAdapter; project: Record<string, unknown>; localProjectId: number } | null> {
    const db = await getDb();
    try {
      const project = await db.get<Record<string, unknown>>(
        "SELECT * FROM projects WHERE id = ?",
        [projectId],
      );
      if (!project) return null;
      return { adapter: db, project, localProjectId: projectId };
    } catch (e) {
      console.error("resolveProject error:", e);
      return null;
    }
  }

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

  // CORS: Allow localhost and Tailscale reverse-proxy origins
  app.use(
    "/*",
    cors({
      origin: (origin) => {
        // Allow same-origin requests (no Origin header)
        if (!origin) return "*";
        // Allow localhost/127.0.0.1/[::1] (IPv4 and IPv6)
        const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
        if (localhostPattern.test(origin)) return origin;
        // Allow Tailscale IPs and internal domains (Caddy reverse proxy)
        const tailscalePattern = /^https?:\/\/(100\.64\.\d+\.\d+|10\.0\.55\.\d+|[a-z0-9.-]+\.xn--rven-qoa\.com)(:\d+)?$/;
        if (tailscalePattern.test(origin)) return origin;
        return "";
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    })
  );

  // Rate limiting for write endpoints (30 requests per minute)
  // Uses getClientIp which only trusts x-forwarded-for when MUNINN_TRUSTED_PROXY=true
  const writeRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: getClientIp,
    message: { error: "Too many write requests, please slow down" },
    standardHeaders: "draft-7",
  });

  // Rate limiting for read endpoints (200 requests per minute)
  const readRateLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 200,
    keyGenerator: getClientIp,
    message: { error: "Too many requests" },
    standardHeaders: "draft-7",
  });

  // Token-based authentication for write operations (H2: Token auth)
  // Set MUNINN_API_TOKEN env var to enable. Localhost bypassed by default.
  app.use("/api/*", createAuthMiddleware());

  // Apply rate limiting to API routes
  app.use("/api/*", readRateLimiter);

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
  // Write API Routes (POST/PUT) - with stricter rate limiting
  // ============================================================================

  // Create Issue
  app.post("/api/projects/:id/issues", writeRateLimiter, async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    try {
      const body = await c.req.json();
      const input = CreateIssueInput.parse(body);

      const insertResult = await db.run(
        `INSERT INTO issues (project_id, title, description, type, severity, status, workaround, created_at)
        VALUES (?, ?, ?, ?, ?, 'open', ?, datetime('now'))`,
        [localProjectId, input.title, input.description ?? null, input.type, input.severity, input.workaround ?? null],
      );

      return c.json({ id: Number(insertResult.lastInsertRowid), message: "Issue created" }, 201);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: e.errors }, 400);
      }
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // Resolve Issue
  app.put("/api/projects/:id/issues/:issueId/resolve", writeRateLimiter, async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const issueId = IssueIdParam.safeParse(c.req.param("issueId"));
    if (!issueId.success) return c.json({ error: "Invalid issue ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    try {
      const body = await c.req.json();
      const input = ResolveIssueInput.parse(body);

      // Verify issue exists and belongs to this project
      const issue = await db.get<{ id: number }>(
        "SELECT id FROM issues WHERE id = ? AND project_id = ?",
        [issueId.data, localProjectId],
      );
      if (!issue) return c.json({ error: "Issue not found" }, 404);

      await db.run(
        "UPDATE issues SET status = 'resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ?",
        [input.resolution, issueId.data],
      );

      return c.json({ message: "Issue resolved" });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: e.errors }, 400);
      }
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // Create Decision
  app.post("/api/projects/:id/decisions", writeRateLimiter, async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    try {
      const body = await c.req.json();
      const input = CreateDecisionInput.parse(body);

      const insertResult = await db.run(
        `INSERT INTO decisions (project_id, title, decision, reasoning, status, created_at)
        VALUES (?, ?, ?, ?, 'active', datetime('now'))`,
        [localProjectId, input.title, input.decision, input.reasoning ?? null],
      );

      return c.json({ id: Number(insertResult.lastInsertRowid), message: "Decision created" }, 201);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: e.errors }, 400);
      }
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // Create Learning
  app.post("/api/projects/:id/learnings", writeRateLimiter, async (c) => {
    const projectId = parseProjectId(c.req.param("id"));
    if (!projectId) return c.json({ error: "Invalid project ID" }, 400);
    const result = await resolveProject(projectId);
    if (!result) return c.json({ error: "Project not found" }, 404);
    const { adapter: db, localProjectId } = result;

    try {
      const body = await c.req.json();
      const input = CreateLearningInput.parse(body);

      const insertResult = await db.run(
        `INSERT INTO learnings (project_id, title, content, category, context, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [localProjectId, input.title, input.content, input.category, input.context ?? null],
      );

      return c.json({ id: Number(insertResult.lastInsertRowid), message: "Learning created" }, 201);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return c.json({ error: "Validation failed", details: e.errors }, 400);
      }
      console.error("API Error:", e);
      return c.json({ error: "Internal server error" }, 500);
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
  const portArg = process.argv[2] || "3334";
  const portResult = SafePort.safeParse(portArg);
  if (!portResult.success) {
    console.error(`Invalid port: ${portArg}. Must be 1-65535.`);
    process.exit(1);
  }
  const port = portResult.data;
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
