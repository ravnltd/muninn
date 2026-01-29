/**
 * Issues Enricher
 *
 * Injects open issues related to the files being touched.
 */

import { BaseEnricher } from "../registry";
import type { EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { issueKey } from "../cache";
import { formatIssueNative } from "../formatter";

interface IssueInfo {
  id: number;
  title: string;
  severity: number;
  type: string;
}

export class IssuesEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "issues",
      priority: 40,
      supportedTools: ["*"],
      tokenBudget: 40,
      enabled: true,
    });
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    const issues: IssueInfo[] = [];
    const seen = new Set<number>();

    for (const filePath of input.files) {
      const cacheKey = issueKey(input.projectId, filePath);

      // Try cache first
      let cached = ctx.cache.get<IssueInfo[]>(cacheKey);

      if (!cached) {
        cached = await getIssuesForFile(ctx, input.projectId, filePath);
        ctx.cache.set(cacheKey, cached, ctx.config.defaultCacheTtlMs);
      }

      for (const issue of cached) {
        if (!seen.has(issue.id)) {
          seen.add(issue.id);
          issues.push(issue);
        }
      }
    }

    if (issues.length === 0) return null;

    // Sort by severity and take top 3
    const topIssues = issues.sort((a, b) => b.severity - a.severity).slice(0, 3);

    const lines = topIssues.map((i) =>
      formatIssueNative({
        id: i.id,
        severity: i.severity,
        title: i.title,
        type: i.type,
      })
    );

    return this.output(lines.join("\n"));
  }
}

async function getIssuesForFile(
  ctx: EnrichmentContext,
  projectId: number,
  filePath: string
): Promise<IssueInfo[]> {
  try {
    const results = await ctx.db.all<{
      id: number;
      title: string;
      severity: number;
      type: string;
    }>(
      `SELECT id, title, severity, type FROM issues
       WHERE project_id = ?
         AND status = 'open'
         AND affected_files LIKE '%' || ? || '%'
       ORDER BY severity DESC
       LIMIT 3`,
      [projectId, filePath]
    );

    return results;
  } catch {
    return [];
  }
}
