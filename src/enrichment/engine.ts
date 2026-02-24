/**
 * Enrichment Engine
 *
 * Orchestrates the enrichment pipeline:
 * 1. Parse tool input to extract files
 * 2. Check cache for existing enrichments
 * 3. Run applicable enrichers in parallel
 * 4. Assemble and format output
 * 5. Record metrics
 */

import type { DatabaseAdapter } from "../database/adapter";
import { LRUCache } from "./cache";
import { assembleResult, wrapEnrichmentOutput } from "./formatter";
import { parseToolInput, shouldSkipPath } from "./parser";
import { EnricherRegistry } from "./registry";
import type {
  EnrichmentCache,
  EnrichmentConfig,
  EnrichmentContext,
  EnrichmentInput,
  EnrichmentResult,
  EnricherOutput,
  ToolType,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import { randomBytes } from "node:crypto";

// Maximum allowed raw input length (1MB)
const MAX_RAW_INPUT_LENGTH = 1_000_000;

// ============================================================================
// Engine Class
// ============================================================================

export class EnrichmentEngine {
  private registry: EnricherRegistry;
  private cache: EnrichmentCache;
  private config: EnrichmentConfig;

  constructor(config: Partial<EnrichmentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = new EnricherRegistry(this.config);
    this.cache = new LRUCache(1000);
  }

  /**
   * Get the enricher registry for registering enrichers
   */
  getRegistry(): EnricherRegistry {
    return this.registry;
  }

  /**
   * Get the cache for direct access
   */
  getCache(): EnrichmentCache {
    return this.cache;
  }

  /**
   * Get the configuration
   */
  getConfig(): EnrichmentConfig {
    return this.config;
  }

  /**
   * Run enrichment for a tool call
   */
  async enrich(
    db: DatabaseAdapter,
    projectId: number,
    projectPath: string,
    tool: string,
    rawInput: string
  ): Promise<EnrichmentResult> {
    const startTime = performance.now();

    // Validate raw input length to prevent DoS
    if (rawInput.length > MAX_RAW_INPUT_LENGTH) {
      return {
        context: "",
        totalTokens: 0,
        enrichersUsed: [],
        metrics: {
          latencyMs: performance.now() - startTime,
          cacheHits: 0,
          cacheMisses: 0,
        },
        error: "Input too large",
      };
    }

    // Parse the input to extract files
    const parsed = parseToolInput(tool, rawInput);

    // Filter out paths that should be skipped
    const files = parsed.files.filter(
      (f) => !shouldSkipPath(f, this.config.skipPatterns)
    );

    // If no files to enrich, return empty result
    if (files.length === 0) {
      return {
        context: "",
        totalTokens: 0,
        enrichersUsed: [],
        metrics: {
          latencyMs: performance.now() - startTime,
          cacheHits: 0,
          cacheMisses: 0,
        },
      };
    }

    const input: EnrichmentInput = {
      tool: parsed.tool,
      files,
      projectPath,
      projectId,
      rawInput,
    };

    const context: EnrichmentContext = {
      db,
      cache: this.cache,
      config: this.config,
    };

    // Get applicable enrichers
    const enrichers = this.registry.getApplicable(input);

    // Run enrichers in parallel
    const outputs = await Promise.all(
      enrichers.map(async (enricher): Promise<EnricherOutput | null> => {
        try {
          return await enricher.enrich(input, context);
        } catch (error) {
          console.error(`Enricher ${enricher.name} failed:`, error);
          return null;
        }
      })
    );

    // Filter out nulls and assemble result
    const validOutputs = outputs.filter((o): o is EnricherOutput => o !== null);

    const cacheStats = this.cache.stats();
    const result = assembleResult(validOutputs, {
      latencyMs: performance.now() - startTime,
      cacheHits: cacheStats.hits,
      cacheMisses: cacheStats.misses,
    });

    // Record metrics (non-blocking)
    this.recordMetrics(db, input, result).catch(() => {
      /* ignore */
    });

    return result;
  }

  /**
   * Get formatted enrichment output for injection
   */
  async getFormattedOutput(
    db: DatabaseAdapter,
    projectId: number,
    projectPath: string,
    tool: string,
    rawInput: string
  ): Promise<string> {
    const result = await this.enrich(db, projectId, projectPath, tool, rawInput);
    return wrapEnrichmentOutput(result);
  }

  /**
   * Check if an operation is approved
   */
  async isApproved(db: DatabaseAdapter, operationId: string): Promise<boolean> {
    try {
      const approval = await db.get<{ approved_at: string | null }>(
        "SELECT approved_at FROM pending_approvals WHERE operation_id = ?",
        [operationId]
      );
      return approval?.approved_at !== null;
    } catch {
      return false;
    }
  }

  /**
   * Approve a pending operation
   * Uses atomic UPDATE with WHERE clause to prevent race conditions
   */
  async approve(db: DatabaseAdapter, operationId: string): Promise<boolean> {
    try {
      // Only approve if not already approved (atomic check-and-set)
      const result = await db.run(
        "UPDATE pending_approvals SET approved_at = CURRENT_TIMESTAMP WHERE operation_id = ? AND approved_at IS NULL",
        [operationId]
      );
      return (result.changes ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Create a pending approval
   */
  async createPendingApproval(
    db: DatabaseAdapter,
    opts: {
      tool: string;
      filePath: string | null;
      reason: string;
      blockLevel: string;
    }
  ): Promise<string> {
    const operationId = generateOperationId();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min expiry

    await db.run(
      `INSERT INTO pending_approvals (operation_id, tool, file_path, reason, block_level, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [operationId, opts.tool, opts.filePath, opts.reason, opts.blockLevel, expiresAt]
    );

    return operationId;
  }

  /**
   * Record enrichment metrics
   */
  private async recordMetrics(
    db: DatabaseAdapter,
    input: EnrichmentInput,
    result: EnrichmentResult
  ): Promise<void> {
    try {
      await db.run(
        `INSERT INTO enrichment_metrics (tool, file_path, latency_ms, enrichers_used, tokens_injected, blocked, cache_hits, cache_misses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.tool,
          input.files[0] || null,
          Math.round(result.metrics.latencyMs),
          JSON.stringify(result.enrichersUsed),
          result.totalTokens,
          result.blocked ? 1 : 0,
          result.metrics.cacheHits,
          result.metrics.cacheMisses,
        ]
      );
    } catch {
      // Ignore metrics errors
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get engine status
   */
  status(): {
    enrichers: Array<{ name: string; enabled: boolean; priority: number; tools: ToolType[] }>;
    cache: { hits: number; misses: number; size: number };
    config: EnrichmentConfig;
  } {
    return {
      enrichers: this.registry.status(),
      cache: this.cache.stats(),
      config: this.config,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique operation ID using cryptographic randomness
 */
function generateOperationId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(12).toString("hex");
  return `op_${timestamp}_${random}`;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let engineInstance: EnrichmentEngine | null = null;

/**
 * Get or create the singleton enrichment engine
 */
export function getEnrichmentEngine(config?: Partial<EnrichmentConfig>): EnrichmentEngine {
  if (!engineInstance) {
    engineInstance = new EnrichmentEngine(config);
  }
  return engineInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetEnrichmentEngine(): void {
  engineInstance = null;
}
