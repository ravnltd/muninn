/**
 * Blocker Enricher
 *
 * Checks file fragility and blocks edits to high-risk files.
 * Implements the approval workflow for critical files.
 */

import { BaseEnricher } from "../registry";
import type { BlockLevel, EnricherOutput, EnrichmentContext, EnrichmentInput } from "../types";
import { fileKey } from "../cache";
import { formatBlocked } from "../formatter";

export class BlockerEnricher extends BaseEnricher {
  constructor() {
    super({
      name: "blocker",
      priority: 20, // Run after file-knowledge
      supportedTools: ["Edit", "Write"],
      tokenBudget: 30,
      enabled: true,
    });
  }

  async enrich(input: EnrichmentInput, ctx: EnrichmentContext): Promise<EnricherOutput | null> {
    // Find the highest fragility among all files
    let maxFragility = 0;
    let maxFragilityFile: string | null = null;
    let fragilityReason: string | null = null;

    for (const filePath of input.files) {
      const cacheKey = fileKey(input.projectId, filePath);

      // Try cache first
      let info = ctx.cache.get<{ fragility: number; fragilityReason: string | null }>(cacheKey);

      if (!info) {
        const record = await ctx.db.get<{
          fragility: number;
          fragility_reason: string | null;
        }>(
          `SELECT fragility, fragility_reason FROM files WHERE project_id = ? AND path = ?`,
          [input.projectId, filePath]
        );

        if (record) {
          info = {
            fragility: record.fragility,
            fragilityReason: record.fragility_reason,
          };
          ctx.cache.set(cacheKey, info, ctx.config.defaultCacheTtlMs);
        }
      }

      if (info && info.fragility > maxFragility) {
        maxFragility = info.fragility;
        maxFragilityFile = filePath;
        fragilityReason = info.fragilityReason;
      }
    }

    // Determine block level based on fragility
    let blockLevel: BlockLevel = "none";
    if (maxFragility >= ctx.config.fragilityBlockThreshold) {
      blockLevel = "hard";
    } else if (maxFragility >= ctx.config.fragilitySoftThreshold) {
      blockLevel = "soft";
    } else if (maxFragility >= ctx.config.fragilityWarnThreshold) {
      blockLevel = "warn";
    }

    // No blocking needed
    if (blockLevel === "none" || !maxFragilityFile) {
      return null;
    }

    // Create pending approval for hard blocks
    let operationId: string | undefined;
    if (blockLevel === "hard") {
      operationId = await this.createApproval(ctx, input.tool, maxFragilityFile, maxFragility);
    }

    // Build reason message
    const reason = buildBlockReason(maxFragility, fragilityReason);

    // Format the blocked message
    const content = formatBlocked({
      level: blockLevel,
      reason,
      file: maxFragilityFile,
      fragility: maxFragility,
      operationId,
    });

    return {
      name: this.name,
      priority: this.priority,
      content,
      tokens: Math.ceil(content.length / 4),
      blocked: {
        level: blockLevel,
        reason,
        operationId,
      },
    };
  }

  private async createApproval(
    ctx: EnrichmentContext,
    tool: string,
    filePath: string,
    fragility: number
  ): Promise<string> {
    const operationId = generateOperationId();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min expiry

    await ctx.db.run(
      `INSERT INTO pending_approvals (operation_id, tool, file_path, reason, block_level, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [operationId, tool, filePath, `Fragility ${fragility}/10`, "hard", expiresAt]
    );

    return operationId;
  }
}

function buildBlockReason(fragility: number, fragilityReason: string | null): string {
  const base = `Fragility ${fragility}/10 - This file is critical.`;
  if (fragilityReason) {
    return `${base} ${fragilityReason}`;
  }
  return base;
}

function generateOperationId(): string {
  const timestamp = Date.now().toString(36);
  const { randomBytes } = require("node:crypto");
  const random = randomBytes(12).toString("hex");
  return `op_${timestamp}_${random}`;
}
