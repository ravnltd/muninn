/**
 * Learnings Enricher
 *
 * Injects applicable learnings, gotchas, and patterns for the files being touched.
 * Uses temperature-aware sorting and effective confidence with decay.
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
  temperature?: string;
  effectiveConfidence?: number;
  native?: string;
}

/**
 * Calculate effective confidence with exponential decay
 * effective_confidence = confidence * e^(-decay_rate * days_since_reinforcement)
 */
function calculateEffectiveConfidence(
  confidence: number,
  lastReinforcedAt: string | null,
  createdAt: string,
  decayRate: number = 0.05
): number {
  const referenceDate = lastReinforcedAt || createdAt;
  const daysSinceReinforcement =
    (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
  return confidence * Math.exp(-decayRate * daysSinceReinforcement);
}

/**
 * Get temperature sort order (hot=0, warm=1, cold=2)
 */
function getTemperatureOrder(temp: string | null): number {
  switch (temp) {
    case "hot":
      return 0;
    case "warm":
      return 1;
    default:
      return 2;
  }
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

    // Sort by temperature first, then by effective confidence
    learnings.sort((a, b) => {
      const tempOrder = getTemperatureOrder(a.temperature ?? null) - getTemperatureOrder(b.temperature ?? null);
      if (tempOrder !== 0) return tempOrder;

      // Use effective confidence (accounts for decay)
      const aConf = a.effectiveConfidence ?? a.confidence;
      const bConf = b.effectiveConfidence ?? b.confidence;
      return bConf - aConf;
    });

    // Cap cold items at 1-2, reserve slots for hot/warm
    const hotWarm = learnings.filter((l) => l.temperature === "hot" || l.temperature === "warm");
    const cold = learnings.filter((l) => l.temperature !== "hot" && l.temperature !== "warm");
    const selected = [
      ...hotWarm.slice(0, 4),
      ...cold.slice(0, Math.max(1, 5 - hotWarm.length)),
    ].slice(0, 5);

    // Format learnings in native format
    const lines = selected.map((l) => {
      if (l.native) {
        return l.native;
      }
      // Use effective confidence for display
      const displayConfidence = l.effectiveConfidence ?? l.confidence;
      return formatLearningNative({
        type: l.category,
        when: l.context || undefined,
        action: l.content.slice(0, 60),
        confidence: Math.round(displayConfidence * 10),
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
    // Try FTS search with temperature and decay columns
    const results = await ctx.db.all<{
      id: number;
      category: string;
      title: string;
      content: string;
      context: string | null;
      confidence: number;
      temperature: string | null;
      last_reinforced_at: string | null;
      created_at: string;
      decay_rate: number | null;
      native_format: string | null;
    }>(
      `SELECT l.id, l.category, l.title, l.content, l.context, l.confidence,
              l.temperature, l.last_reinforced_at, l.created_at,
              l.decay_rate, nk.native_format
       FROM fts_learnings
       JOIN learnings l ON fts_learnings.rowid = l.id
       LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
       WHERE fts_learnings MATCH ?
         AND (l.project_id = ? OR l.project_id IS NULL)
         AND l.archived_at IS NULL
       ORDER BY
         CASE l.temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
         bm25(fts_learnings)
       LIMIT 5`,
      [term, projectId]
    );

    return results.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      content: r.content,
      context: r.context,
      confidence: r.confidence,
      temperature: r.temperature ?? "cold",
      effectiveConfidence: calculateEffectiveConfidence(
        r.confidence,
        r.last_reinforced_at,
        r.created_at,
        r.decay_rate ?? 0.05
      ),
      native: r.native_format ?? undefined,
    }));
  } catch {
    // FTS might fail or columns might not exist, fall back to simpler query
    try {
      const results = await ctx.db.all<{
        id: number;
        category: string;
        title: string;
        content: string;
        context: string | null;
        confidence: number;
        temperature: string | null;
        created_at: string;
      }>(
        `SELECT id, category, title, content, context, confidence,
                temperature, created_at
         FROM learnings
         WHERE (project_id = ? OR project_id IS NULL)
           AND (title LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%')
           AND archived_at IS NULL
         ORDER BY
           CASE temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
           times_applied DESC
         LIMIT 5`,
        [projectId, term, term]
      );

      return results.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        content: r.content,
        context: r.context,
        confidence: r.confidence,
        temperature: r.temperature ?? "cold",
        effectiveConfidence: calculateEffectiveConfidence(
          r.confidence,
          null,
          r.created_at,
          0.05
        ),
        native: undefined,
      }));
    } catch {
      return [];
    }
  }
}

async function getGotchas(ctx: EnrichmentContext, projectId: number): Promise<LearningInfo[]> {
  try {
    // Gotchas decay slower (0.02/day vs 0.05/day default) since they're critical warnings
    const results = await ctx.db.all<{
      id: number;
      category: string;
      title: string;
      content: string;
      context: string | null;
      confidence: number;
      temperature: string | null;
      last_reinforced_at: string | null;
      created_at: string;
      decay_rate: number | null;
      native_format: string | null;
    }>(
      `SELECT l.id, l.category, l.title, l.content, l.context, l.confidence,
              l.temperature, l.last_reinforced_at, l.created_at,
              l.decay_rate, nk.native_format
       FROM learnings l
       LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
       WHERE (l.project_id = ? OR l.project_id IS NULL)
         AND l.category = 'gotcha'
         AND l.archived_at IS NULL
       ORDER BY
         CASE l.temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
         l.times_applied DESC, l.confidence DESC
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
      temperature: r.temperature ?? "cold",
      // Gotchas use slower decay rate (0.02) unless explicitly set
      effectiveConfidence: calculateEffectiveConfidence(
        r.confidence,
        r.last_reinforced_at,
        r.created_at,
        r.decay_rate ?? 0.02
      ),
      native: r.native_format ?? undefined,
    }));
  } catch {
    return [];
  }
}
