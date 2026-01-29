/**
 * File Knowledge Enricher
 *
 * Injects file metadata: fragility, purpose, type, dependencies.
 */

import { BaseEnricher } from "../registry";
import type { EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { fileKey } from "../cache";
import { formatFileNative } from "../formatter";

interface FileInfo {
  fragility: number;
  fragilityReason: string | null;
  purpose: string | null;
  type: string | null;
  dependents: number;
}

export class FileKnowledgeEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "file-knowledge",
      priority: 10,
      supportedTools: ["*"],
      tokenBudget: 50,
      enabled: true,
    });
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    const lines: string[] = [];

    for (const filePath of input.files) {
      const cacheKey = fileKey(input.projectId, filePath);

      // Try cache first
      let info = ctx.cache.get<FileInfo>(cacheKey);

      if (!info) {
        // Query database
        const record = await ctx.db.get<{
          fragility: number;
          fragility_reason: string | null;
          purpose: string | null;
          type: string | null;
          dependents: string | null;
        }>(
          `SELECT fragility, fragility_reason, purpose, type, dependents
           FROM files WHERE project_id = ? AND path = ?`,
          [input.projectId, filePath]
        );

        if (record) {
          const dependents = record.dependents ? JSON.parse(record.dependents) : [];
          info = {
            fragility: record.fragility,
            fragilityReason: record.fragility_reason,
            purpose: record.purpose,
            type: record.type,
            dependents: dependents.length,
          };

          ctx.cache.set(cacheKey, info, ctx.config.defaultCacheTtlMs);
        }
      }

      if (info) {
        const formatted = formatFileNative({
          path: filePath,
          fragility: info.fragility,
          purpose: info.purpose || undefined,
          type: info.type || undefined,
          deps: info.dependents,
        });
        lines.push(formatted);
      }
    }

    if (lines.length === 0) return null;

    return this.output(lines.join("\n"));
  }
}
