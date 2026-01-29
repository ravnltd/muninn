/**
 * Decisions Enricher
 *
 * Injects active decisions that affect the files being touched.
 */

import { BaseEnricher } from "../registry";
import type { EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { decisionKey } from "../cache";
import { formatDecisionNative } from "../formatter";

interface DecisionInfo {
  id: number;
  title: string;
  decision: string;
  reasoning: string | null;
  outcomeStatus: string;
  native?: string;
}

export class DecisionsEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "decisions",
      priority: 50,
      supportedTools: ["*"],
      tokenBudget: 60,
      enabled: true,
    });
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    const decisions: DecisionInfo[] = [];
    const seen = new Set<number>();

    for (const filePath of input.files) {
      const cacheKey = decisionKey(input.projectId, filePath);

      // Try cache first
      let cached = ctx.cache.get<DecisionInfo[]>(cacheKey);

      if (!cached) {
        cached = await getDecisionsForFile(ctx, input.projectId, filePath);
        ctx.cache.set(cacheKey, cached, ctx.config.defaultCacheTtlMs);
      }

      for (const decision of cached) {
        if (!seen.has(decision.id)) {
          seen.add(decision.id);
          decisions.push(decision);
        }
      }
    }

    if (decisions.length === 0) return null;

    // Take top 3 decisions
    const topDecisions = decisions.slice(0, 3);

    const lines = topDecisions.map((d) => {
      if (d.native) {
        return d.native;
      }
      return formatDecisionNative({
        title: d.title,
        choice: d.decision.slice(0, 40),
        why: d.reasoning?.slice(0, 40) || undefined,
        outcome: d.outcomeStatus,
      });
    });

    return this.output(lines.join("\n"));
  }
}

async function getDecisionsForFile(
  ctx: EnrichmentContext,
  projectId: number,
  filePath: string
): Promise<DecisionInfo[]> {
  try {
    const results = await ctx.db.all<{
      id: number;
      title: string;
      decision: string;
      reasoning: string | null;
      outcome_status: string;
      native_format: string | null;
    }>(
      `SELECT d.id, d.title, d.decision, d.reasoning, d.outcome_status, nk.native_format
       FROM decisions d
       LEFT JOIN native_knowledge nk ON nk.source_table = 'decisions' AND nk.source_id = d.id
       WHERE d.project_id = ?
         AND d.status = 'active'
         AND d.affects LIKE '%' || ? || '%'
       ORDER BY d.decided_at DESC
       LIMIT 3`,
      [projectId, filePath]
    );

    return results.map((r) => ({
      id: r.id,
      title: r.title,
      decision: r.decision,
      reasoning: r.reasoning,
      outcomeStatus: r.outcome_status,
      native: r.native_format ?? undefined,
    }));
  } catch {
    return [];
  }
}
