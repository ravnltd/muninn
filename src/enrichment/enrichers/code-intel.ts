/**
 * Code Intelligence Enricher
 *
 * Surfaces symbol counts, callers, and test coverage from existing
 * code-intel tables (symbols, call_graph, test_source_map).
 * Priority 65 — between BlastRadius (60) and Correlations (70).
 */

import { BaseEnricher } from "../registry";
import type { EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { codeIntelKey } from "../cache";
import { formatCodeIntelNative } from "../formatter";

interface CodeIntelInfo {
  exports: number;
  callers: number;
  callerFiles: number;
  tests: number;
  topCallers: string[];
}

export class CodeIntelEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "code-intel",
      priority: 65,
      supportedTools: ["Edit", "Write"],
      tokenBudget: 60,
      enabled: true,
    });
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    const lines: string[] = [];

    for (const filePath of input.files) {
      const cacheKey = codeIntelKey(input.projectId, filePath);

      let info = ctx.cache.get<CodeIntelInfo>(cacheKey);

      if (!info) {
        const result = await getCodeIntelSummary(ctx, input.projectId, filePath);
        if (result) {
          info = result;
          ctx.cache.set(cacheKey, info, ctx.config.defaultCacheTtlMs);
        }
      }

      if (info && (info.exports > 0 || info.callers > 0 || info.tests > 0)) {
        const basename = filePath.split("/").pop() || filePath;
        lines.push(formatCodeIntelNative({
          file: basename,
          exports: info.exports,
          callers: info.callers,
          callerFiles: info.callerFiles,
          tests: info.tests,
          topCallers: info.topCallers,
        }));
      }
    }

    if (lines.length === 0) return null;

    return this.output(lines.join("\n"));
  }
}

async function getCodeIntelSummary(
  ctx: EnrichmentContext,
  projectId: number,
  filePath: string
): Promise<CodeIntelInfo | null> {
  try {
    // Count exported symbols
    const symbolResult = await ctx.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM symbols
       WHERE project_id = ? AND file_path = ? AND is_exported = 1`,
      [projectId, filePath]
    );

    // Count callers from call_graph
    const callerResult = await ctx.db.get<{ caller_count: number; file_count: number }>(
      `SELECT COUNT(*) as caller_count, COUNT(DISTINCT caller_file) as file_count
       FROM call_graph
       WHERE project_id = ? AND callee_file = ?`,
      [projectId, filePath]
    );

    // Get top caller files
    const topCallers = await ctx.db.all<{ caller_file: string }>(
      `SELECT caller_file, COUNT(*) as cnt
       FROM call_graph
       WHERE project_id = ? AND callee_file = ?
       GROUP BY caller_file
       ORDER BY cnt DESC
       LIMIT 3`,
      [projectId, filePath]
    );

    // Count mapped tests
    const testResult = await ctx.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM test_source_map
       WHERE project_id = ? AND source_file = ?`,
      [projectId, filePath]
    );

    const exports = symbolResult?.count ?? 0;
    const callers = callerResult?.caller_count ?? 0;
    const callerFiles = callerResult?.file_count ?? 0;
    const tests = testResult?.count ?? 0;

    if (exports === 0 && callers === 0 && tests === 0) return null;

    return {
      exports,
      callers,
      callerFiles,
      tests,
      topCallers: topCallers.map((c) => c.caller_file.split("/").pop() || c.caller_file),
    };
  } catch {
    return null;
  }
}
