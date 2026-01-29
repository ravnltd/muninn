/**
 * Blast Radius Enricher
 *
 * Injects impact summary showing how many files would be affected by changes.
 */

import { BaseEnricher } from "../registry";
import type { EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { blastKey } from "../cache";
import { formatBlastNative } from "../formatter";

interface BlastInfo {
  score: number;
  direct: number;
  transitive: number;
  tests: number;
  routes: number;
}

export class BlastRadiusEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "blast-radius",
      priority: 60,
      supportedTools: ["Edit", "Write"],
      tokenBudget: 40,
      enabled: true,
    });
  }

  canEnrich(input: EnrichmentInput): boolean {
    // Only enrich if blast radius tracking is enabled
    return input.files.length > 0;
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    if (!ctx.config.includeBlastRadius) return null;

    const lines: string[] = [];

    for (const filePath of input.files) {
      const cacheKey = blastKey(input.projectId, filePath);

      // Try cache first
      let info = ctx.cache.get<BlastInfo>(cacheKey);

      if (!info) {
        const result = await getBlastSummary(ctx, input.projectId, filePath);
        if (result) {
          info = result;
          ctx.cache.set(cacheKey, info, ctx.config.defaultCacheTtlMs);
        }
      }

      if (info && info.score > 0) {
        const risk = calculateRisk(info.score);
        const formatted = formatBlastNative({
          score: info.score,
          direct: info.direct,
          transitive: info.transitive,
          tests: info.tests,
          routes: info.routes,
          risk,
        });
        lines.push(formatted);
      }
    }

    if (lines.length === 0) return null;

    return this.output(lines.join("\n"));
  }
}

async function getBlastSummary(
  ctx: EnrichmentContext,
  projectId: number,
  filePath: string
): Promise<BlastInfo | null> {
  try {
    const result = await ctx.db.get<{
      blast_score: number;
      direct_dependents: number;
      transitive_dependents: number;
      affected_tests: number;
      affected_routes: number;
    }>(
      `SELECT blast_score, direct_dependents, transitive_dependents, affected_tests, affected_routes
       FROM blast_summary
       WHERE project_id = ? AND file_path = ?`,
      [projectId, filePath]
    );

    if (!result) return null;

    return {
      score: result.blast_score,
      direct: result.direct_dependents,
      transitive: result.transitive_dependents,
      tests: result.affected_tests,
      routes: result.affected_routes,
    };
  } catch {
    return null;
  }
}

function calculateRisk(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 80) return "critical";
  if (score >= 50) return "high";
  if (score >= 20) return "medium";
  return "low";
}
