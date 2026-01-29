/**
 * Correlations Enricher
 *
 * Injects co-changing files that typically change together with the current files.
 */

import { BaseEnricher } from "../registry";
import type { EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { correlationKey } from "../cache";
import { formatRelationsNative } from "../formatter";

interface CorrelationInfo {
  file: string;
  count: number;
}

export class CorrelationsEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "correlations",
      priority: 70,
      supportedTools: ["Edit", "Write"],
      tokenBudget: 30,
      enabled: true,
    });
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    if (!ctx.config.includeCorrelations) return null;

    const allCorrelations: CorrelationInfo[] = [];
    const seen = new Set(input.files);

    for (const filePath of input.files) {
      const cacheKey = correlationKey(input.projectId, filePath);

      // Try cache first
      let cached = ctx.cache.get<CorrelationInfo[]>(cacheKey);

      if (!cached) {
        cached = await getCorrelatedFiles(ctx, input.projectId, filePath);
        ctx.cache.set(cacheKey, cached, ctx.config.defaultCacheTtlMs);
      }

      for (const corr of cached) {
        if (!seen.has(corr.file)) {
          seen.add(corr.file);
          allCorrelations.push(corr);
        }
      }
    }

    if (allCorrelations.length === 0) return null;

    // Sort by count and take top 3
    const top = allCorrelations.sort((a, b) => b.count - a.count).slice(0, 3);

    const formatted = formatRelationsNative({
      cochangers: top.map((c) => c.file),
    });

    if (!formatted) return null;

    return this.output(formatted);
  }
}

async function getCorrelatedFiles(
  ctx: EnrichmentContext,
  projectId: number,
  filePath: string
): Promise<CorrelationInfo[]> {
  try {
    // Query both directions of the correlation
    const results = await ctx.db.all<{
      correlated_file: string;
      cochange_count: number;
    }>(
      `SELECT
         CASE
           WHEN file_a = ? THEN file_b
           ELSE file_a
         END as correlated_file,
         cochange_count
       FROM file_correlations
       WHERE project_id = ? AND (file_a = ? OR file_b = ?)
       ORDER BY cochange_count DESC
       LIMIT 5`,
      [filePath, projectId, filePath, filePath]
    );

    return results.map((r) => ({
      file: r.correlated_file,
      count: r.cochange_count,
    }));
  } catch {
    return [];
  }
}
