/**
 * Enrichment Layer
 *
 * Automatic context injection for tool calls.
 * Transforms Muninn from pull-based to push-based intelligence.
 *
 * Usage:
 * ```typescript
 * import { enrich, getEnrichmentEngine } from "./enrichment";
 *
 * // Get formatted context for a tool call
 * const context = await enrich(db, projectId, projectPath, "Edit", '{"file_path": "src/index.ts"}');
 *
 * // Or use the engine directly
 * const engine = getEnrichmentEngine();
 * const result = await engine.enrich(db, projectId, projectPath, "Edit", rawInput);
 * ```
 */

// Re-export types
export type {
  BlockLevel,
  DatabaseAdapter,
  Enricher,
  EnricherConfig,
  EnricherOutput,
  EnrichmentCache,
  EnrichmentConfig,
  EnrichmentContext,
  EnrichmentInput,
  EnrichmentMetrics,
  EnrichmentResult,
  PendingApproval,
  ToolType,
} from "./types";
export { DEFAULT_CONFIG } from "./types";

// Re-export cache utilities
export { LRUCache, blastKey, correlationKey, decisionKey, fileKey, issueKey, learningKey, testFileKey } from "./cache";

// Re-export parser utilities
export { parseToolInput, shouldSkipPath } from "./parser";
export type { ParsedInput } from "./parser";

// Re-export formatter utilities
export {
  assembleResult,
  estimateTokens,
  formatBlastNative,
  formatBlocked,
  formatDecisionNative,
  formatEnrichmentHeader,
  formatFileNative,
  formatIssueNative,
  formatLearningNative,
  formatRelationsNative,
  wrapEnrichmentOutput,
} from "./formatter";

// Re-export registry
export { BaseEnricher, EnricherRegistry } from "./registry";

// Re-export engine
export { EnrichmentEngine, getEnrichmentEngine, resetEnrichmentEngine } from "./engine";

// Re-export enrichers
export {
  BlockerEnricher,
  BlastRadiusEnricher,
  CorrelationsEnricher,
  DecisionsEnricher,
  FileKnowledgeEnricher,
  IssuesEnricher,
  LearningsEnricher,
  TestsEnricher,
  createBuiltinEnrichers,
  registerBuiltinEnrichers,
} from "./enrichers";

// ============================================================================
// Initialization
// ============================================================================

import type { DatabaseAdapter } from "../database/adapter";
import { getEnrichmentEngine } from "./engine";
import { registerBuiltinEnrichers } from "./enrichers";

let initialized = false;

/**
 * Initialize the enrichment engine with built-in enrichers.
 * Call this once at startup.
 */
export function initializeEnrichment(): void {
  if (initialized) return;

  const engine = getEnrichmentEngine();
  registerBuiltinEnrichers(engine);
  initialized = true;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run enrichment and get formatted output string
 *
 * This is the main entry point for enrichment.
 * Automatically initializes enrichers on first call.
 */
export async function enrich(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  tool: string,
  rawInput: string
): Promise<string> {
  initializeEnrichment();
  const engine = getEnrichmentEngine();
  return engine.getFormattedOutput(db, projectId, projectPath, tool, rawInput);
}

/**
 * Run enrichment and get structured result
 */
export async function enrichWithResult(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  tool: string,
  rawInput: string
): Promise<import("./types").EnrichmentResult> {
  initializeEnrichment();
  const engine = getEnrichmentEngine();
  return engine.enrich(db, projectId, projectPath, tool, rawInput);
}

/**
 * Approve a blocked operation
 */
export async function approveOperation(db: DatabaseAdapter, operationId: string): Promise<boolean> {
  const engine = getEnrichmentEngine();
  return engine.approve(db, operationId);
}

/**
 * Check if an operation is approved
 */
export async function isOperationApproved(db: DatabaseAdapter, operationId: string): Promise<boolean> {
  const engine = getEnrichmentEngine();
  return engine.isApproved(db, operationId);
}
