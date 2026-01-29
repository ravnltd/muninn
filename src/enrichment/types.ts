/**
 * Enrichment Layer Types
 *
 * Defines interfaces for the context enrichment system that automatically
 * injects relevant context before tool execution.
 */

// ============================================================================
// Tool Types
// ============================================================================

export type ToolType = "Read" | "Edit" | "Write" | "Bash" | "Glob" | "Grep" | "*";

export type BlockLevel = "none" | "warn" | "soft" | "hard";

// ============================================================================
// Enrichment Input/Output
// ============================================================================

export interface EnrichmentInput {
  tool: ToolType;
  files: string[];
  projectPath: string;
  projectId: number;
  rawInput?: string;
}

export interface EnricherOutput {
  name: string;
  priority: number;
  content: string;
  tokens: number;
  blocked?: {
    level: BlockLevel;
    reason: string;
    operationId?: string;
  };
}

export interface EnrichmentResult {
  context: string;
  totalTokens: number;
  enrichersUsed: string[];
  blocked?: {
    level: BlockLevel;
    reason: string;
    operationId: string;
    file?: string;
  };
  metrics: {
    latencyMs: number;
    cacheHits: number;
    cacheMisses: number;
  };
}

// ============================================================================
// Enricher Interface
// ============================================================================

export interface EnricherConfig {
  /** Unique name for this enricher */
  name: string;
  /** Lower priority runs first, appears first in output */
  priority: number;
  /** Which tools this enricher applies to ("*" for all) */
  supportedTools: ToolType[];
  /** Maximum tokens this enricher should use */
  tokenBudget: number;
  /** Whether this enricher is enabled */
  enabled: boolean;
}

export interface Enricher extends EnricherConfig {
  /**
   * Check if this enricher should run for the given input
   */
  canEnrich(input: EnrichmentInput): boolean;

  /**
   * Generate enrichment content for the given input
   */
  enrich(
    input: EnrichmentInput,
    context: EnrichmentContext
  ): Promise<EnricherOutput | null>;
}

// ============================================================================
// Context & Cache
// ============================================================================

export interface EnrichmentContext {
  db: DatabaseAdapter;
  cache: EnrichmentCache;
  config: EnrichmentConfig;
}

export interface EnrichmentCache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  stats(): { hits: number; misses: number; size: number };
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface EnrichmentConfig {
  /** Maximum total tokens for all enrichers combined */
  totalTokenBudget: number;
  /** Default TTL for cache entries in milliseconds */
  defaultCacheTtlMs: number;
  /** Patterns to skip (e.g., node_modules, .git) */
  skipPatterns: string[];
  /** Block threshold for fragility (files >= this require approval) */
  fragilityBlockThreshold: number;
  /** Soft block threshold (files >= this show warning) */
  fragilitySoftThreshold: number;
  /** Warn threshold (files >= this show warning) */
  fragilityWarnThreshold: number;
  /** Whether to include blast radius info */
  includeBlastRadius: boolean;
  /** Whether to include correlation info */
  includeCorrelations: boolean;
  /** Whether to include test file suggestions */
  includeTestFiles: boolean;
  /** Custom enricher configurations */
  enrichers: Record<string, Partial<EnricherConfig>>;
}

export const DEFAULT_CONFIG: EnrichmentConfig = {
  totalTokenBudget: 500,
  defaultCacheTtlMs: 5 * 60 * 1000, // 5 minutes
  skipPatterns: [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "*.lock",
    "package-lock.json",
    "bun.lockb",
  ],
  fragilityBlockThreshold: 9,
  fragilitySoftThreshold: 8,
  fragilityWarnThreshold: 7,
  includeBlastRadius: true,
  includeCorrelations: true,
  includeTestFiles: true,
  enrichers: {},
};

// ============================================================================
// Pending Approvals
// ============================================================================

export interface PendingApproval {
  id: number;
  operationId: string;
  tool: string;
  filePath: string | null;
  reason: string;
  blockLevel: BlockLevel;
  createdAt: string;
  expiresAt: string | null;
  approvedAt: string | null;
}

// ============================================================================
// Metrics
// ============================================================================

export interface EnrichmentMetrics {
  id: number;
  tool: string;
  filePath: string | null;
  latencyMs: number;
  enrichersUsed: string;
  tokensInjected: number;
  blocked: boolean;
  cacheHits: number;
  cacheMisses: number;
  createdAt: string;
}

// ============================================================================
// Database Adapter (re-export for convenience)
// ============================================================================

import type { DatabaseAdapter } from "../database/adapter";
export type { DatabaseAdapter };
