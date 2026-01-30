/**
 * Decisions Enricher
 *
 * Injects active decisions that affect the files being touched.
 * Prioritizes showing decisions with known outcomes, especially failed ones
 * as warnings to avoid repeating mistakes.
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
  outcomeNotes: string | null;
  temperature?: string;
  native?: string;
}

/**
 * Get outcome sort priority (failed=0, revised=1, succeeded=2, pending=3)
 * Failed decisions should surface first as warnings
 */
function getOutcomePriority(status: string): number {
  switch (status) {
    case "failed":
      return 0; // Show first - these are warnings!
    case "revised":
      return 1;
    case "succeeded":
      return 2;
    default:
      return 3;
  }
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

    // Sort by outcome priority (failed first) then by recency
    decisions.sort((a, b) => {
      const outcomeDiff = getOutcomePriority(a.outcomeStatus) - getOutcomePriority(b.outcomeStatus);
      if (outcomeDiff !== 0) return outcomeDiff;
      return 0; // Maintain existing order for same outcome
    });

    // Take top 3 decisions
    const topDecisions = decisions.slice(0, 3);

    const lines = topDecisions.map((d) => {
      // Add warning prefix for failed decisions
      const prefix = d.outcomeStatus === "failed" ? "⚠️ FAILED: " : "";

      if (d.native) {
        return prefix + d.native;
      }

      // Include outcome notes for failed decisions
      const why =
        d.outcomeStatus === "failed" && d.outcomeNotes
          ? `FAILED: ${d.outcomeNotes.slice(0, 30)}`
          : d.reasoning?.slice(0, 40) || undefined;

      return formatDecisionNative({
        title: prefix + d.title,
        choice: d.decision.slice(0, 40),
        why,
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
      outcome_notes: string | null;
      temperature: string | null;
      native_format: string | null;
    }>(
      `SELECT d.id, d.title, d.decision, d.reasoning, d.outcome_status,
              d.outcome_notes, d.temperature, nk.native_format
       FROM decisions d
       LEFT JOIN native_knowledge nk ON nk.source_table = 'decisions' AND nk.source_id = d.id
       WHERE d.project_id = ?
         AND d.status = 'active'
         AND d.affects LIKE '%' || ? || '%'
       ORDER BY
         CASE d.outcome_status WHEN 'failed' THEN 0 WHEN 'revised' THEN 1 ELSE 2 END,
         CASE d.temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
         d.decided_at DESC
       LIMIT 5`,
      [projectId, filePath]
    );

    return results.map((r) => ({
      id: r.id,
      title: r.title,
      decision: r.decision,
      reasoning: r.reasoning,
      outcomeStatus: r.outcome_status || "pending",
      outcomeNotes: r.outcome_notes,
      temperature: r.temperature ?? undefined,
      native: r.native_format ?? undefined,
    }));
  } catch {
    return [];
  }
}
