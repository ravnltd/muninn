/**
 * Learnings Enricher
 *
 * Injects applicable learnings, gotchas, and patterns for the files being touched.
 */

import { BaseEnricher } from "../registry";
import type { EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { learningKey } from "../cache";
import { formatLearningNative } from "../formatter";

interface LearningInfo {
  id: number;
  category: string;
  title: string;
  content: string;
  context: string | null;
  confidence: number;
  native?: string;
}

export class LearningsEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "learnings",
      priority: 30,
      supportedTools: ["*"],
      tokenBudget: 80,
      enabled: true,
    });
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    // Build search terms from file paths
    const searchTerms = buildSearchTerms(input.files);
    if (searchTerms.length === 0) return null;

    const learnings: LearningInfo[] = [];

    for (const term of searchTerms.slice(0, 3)) {
      const cacheKey = learningKey(input.projectId, term);

      // Try cache first
      let cached = ctx.cache.get<LearningInfo[]>(cacheKey);

      if (!cached) {
        cached = await searchLearnings(ctx, input.projectId, term);
        ctx.cache.set(cacheKey, cached, ctx.config.defaultCacheTtlMs);
      }

      for (const l of cached) {
        if (!learnings.find((x) => x.id === l.id)) {
          learnings.push(l);
        }
      }
    }

    // Also get gotchas (always relevant)
    const gotchas = await getGotchas(ctx, input.projectId);
    for (const g of gotchas) {
      if (!learnings.find((x) => x.id === g.id)) {
        learnings.push(g);
      }
    }

    if (learnings.length === 0) return null;

    // Format learnings in native format
    const lines = learnings.slice(0, 5).map((l) => {
      if (l.native) {
        return l.native;
      }
      return formatLearningNative({
        type: l.category,
        when: l.context || undefined,
        action: l.content.slice(0, 60),
        confidence: Math.round(l.confidence * 10),
      });
    });

    return this.output(lines.join("\n"));
  }
}

function buildSearchTerms(files: string[]): string[] {
  const terms = new Set<string>();

  for (const file of files) {
    // Extract meaningful parts from path
    const parts = file.split("/").filter((p) => p && !p.includes("."));

    // Add directory names
    for (const part of parts) {
      if (part.length >= 3) {
        terms.add(part);
      }
    }

    // Add file basename without extension
    const basename = file.split("/").pop()?.replace(/\.[^/.]+$/, "");
    if (basename && basename.length >= 3) {
      terms.add(basename);
    }
  }

  return Array.from(terms);
}

async function searchLearnings(
  ctx: EnrichmentContext,
  projectId: number,
  term: string
): Promise<LearningInfo[]> {
  try {
    // Try FTS search first
    const results = await ctx.db.all<{
      id: number;
      category: string;
      title: string;
      content: string;
      context: string | null;
      confidence: number;
      native_format: string | null;
    }>(
      `SELECT l.id, l.category, l.title, l.content, l.context, l.confidence, nk.native_format
       FROM fts_learnings
       JOIN learnings l ON fts_learnings.rowid = l.id
       LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
       WHERE fts_learnings MATCH ?
         AND (l.project_id = ? OR l.project_id IS NULL)
       ORDER BY bm25(fts_learnings)
       LIMIT 3`,
      [term, projectId]
    );

    return results.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      content: r.content,
      context: r.context,
      confidence: r.confidence,
      native: r.native_format ?? undefined,
    }));
  } catch {
    // FTS might fail, fall back to LIKE search
    try {
      const results = await ctx.db.all<{
        id: number;
        category: string;
        title: string;
        content: string;
        context: string | null;
        confidence: number;
      }>(
        `SELECT id, category, title, content, context, confidence
         FROM learnings
         WHERE (project_id = ? OR project_id IS NULL)
           AND (title LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%')
         ORDER BY times_applied DESC
         LIMIT 3`,
        [projectId, term, term]
      );

      return results.map((r) => ({
        ...r,
        native: undefined,
      }));
    } catch {
      return [];
    }
  }
}

async function getGotchas(ctx: EnrichmentContext, projectId: number): Promise<LearningInfo[]> {
  try {
    const results = await ctx.db.all<{
      id: number;
      category: string;
      title: string;
      content: string;
      context: string | null;
      confidence: number;
      native_format: string | null;
    }>(
      `SELECT l.id, l.category, l.title, l.content, l.context, l.confidence, nk.native_format
       FROM learnings l
       LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
       WHERE (l.project_id = ? OR l.project_id IS NULL)
         AND l.category = 'gotcha'
       ORDER BY l.times_applied DESC, l.confidence DESC
       LIMIT 2`,
      [projectId]
    );

    return results.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      content: r.content,
      context: r.context,
      confidence: r.confidence,
      native: r.native_format ?? undefined,
    }));
  } catch {
    return [];
  }
}
