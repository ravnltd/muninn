/**
 * Zod schemas and parse helpers for web API input validation.
 */

import { z } from "zod";

// Path/Query param schemas
export const ProjectIdParam = z.coerce.number().int().positive();
export const IssueIdParam = z.coerce.number().int().positive();
export const SearchQuery = z.string().min(1).max(500);

// Helper to validate path params
export function parseProjectId(id: string): number | null {
  const result = ProjectIdParam.safeParse(id);
  return result.success ? result.data : null;
}

/**
 * Escape FTS5 special characters to prevent query injection.
 * FTS5 operators: AND, OR, NOT, NEAR, *, ", ^
 */
export function escapeFtsQuery(query: string): string {
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
export const CreateIssueInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  type: z.enum(["bug", "tech-debt", "enhancement", "question", "potential"]).default("bug"),
  severity: z.number().int().min(1).max(10).default(5),
  workaround: z.string().max(5000).optional(),
});

export const ResolveIssueInput = z.object({
  resolution: z.string().min(1).max(5000),
});

export const CreateDecisionInput = z.object({
  title: z.string().min(1).max(500),
  decision: z.string().min(1).max(10000),
  reasoning: z.string().max(10000).optional(),
});

export const CreateLearningInput = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(10000),
  category: z.enum(["pattern", "gotcha", "preference", "convention", "architecture"]).default("pattern"),
  context: z.string().max(5000).optional(),
});
