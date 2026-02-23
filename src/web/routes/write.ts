/**
 * Write routes (POST/PUT) for the dashboard API with stricter rate limiting.
 */

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { DatabaseAdapter } from "../../database/adapter";
import {
  parseProjectId,
  IssueIdParam,
  CreateIssueInput,
  ResolveIssueInput,
  CreateDecisionInput,
  CreateLearningInput,
} from "../schemas";

export interface WriteRouteDeps {
  resolveProject: (
    projectId: number,
  ) => Promise<{ adapter: DatabaseAdapter; project: Record<string, unknown>; localProjectId: number } | null>;
}

export function registerWriteRoutes(app: Hono, deps: WriteRouteDeps, writeRateLimiter: MiddlewareHandler): void {
  const { resolveProject } = deps;

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
}
