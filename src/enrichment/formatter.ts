/**
 * Transformer-Native Output Formatter
 *
 * Formats enrichment output in a dense, token-efficient format
 * optimized for LLM attention patterns.
 *
 * Format specifications:
 * - F[path|frag:N|purpose:text|deps:N] - File knowledge
 * - K[type|ent:x,y|when:cond|do:action|conf:N] - Learning/knowledge
 * - D[title|choice:x|alt:y|why:reason|conf:N] - Decision
 * - I[#id|sev:N|title] - Issue
 * - B[score:N|direct:N|trans:N|tests:N|risk:level] - Blast radius
 * - R[cochangers:a,b|tests:c,d] - Relationships
 * - !BLOCKED: reason - Blocking message
 */

import type { BlockLevel, EnricherOutput, EnrichmentResult } from "./types";

// ============================================================================
// String Escaping
// ============================================================================

/**
 * Escape special characters in user data to prevent format injection.
 * Escapes |, [, and ] which are used as delimiters in the native format.
 */
function escapeNativeFormat(text: string): string {
  return text
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/\|/g, "\\|") // Escape pipe delimiter
    .replace(/\[/g, "\\[") // Escape opening bracket
    .replace(/\]/g, "\\]"); // Escape closing bracket
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count (rough: ~4 chars per token for English)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format file knowledge in native format
 */
export function formatFileNative(opts: {
  path: string;
  fragility?: number;
  purpose?: string;
  deps?: number;
  type?: string;
}): string {
  const parts = [escapeNativeFormat(opts.path)];

  if (opts.fragility !== undefined && opts.fragility > 0) {
    parts.push(`frag:${opts.fragility}`);
  }
  if (opts.type) {
    parts.push(`type:${escapeNativeFormat(opts.type)}`);
  }
  if (opts.purpose) {
    parts.push(`purpose:${escapeNativeFormat(opts.purpose.slice(0, 50))}`);
  }
  if (opts.deps !== undefined && opts.deps > 0) {
    parts.push(`deps:${opts.deps}`);
  }

  return `F[${parts.join("|")}]`;
}

/**
 * Format learning in native format
 */
export function formatLearningNative(opts: {
  type: string;
  entities?: string[];
  when?: string;
  action?: string;
  why?: string;
  confidence?: number;
}): string {
  const parts = [escapeNativeFormat(opts.type)];

  if (opts.entities && opts.entities.length > 0) {
    parts.push(`ent:${opts.entities.slice(0, 5).map(escapeNativeFormat).join(",")}`);
  }
  if (opts.when) {
    parts.push(`when:${escapeNativeFormat(opts.when.slice(0, 30))}`);
  }
  if (opts.action) {
    parts.push(`do:${escapeNativeFormat(opts.action.slice(0, 30))}`);
  }
  if (opts.why) {
    parts.push(`why:${escapeNativeFormat(opts.why.slice(0, 40))}`);
  }
  if (opts.confidence !== undefined) {
    parts.push(`conf:${opts.confidence}`);
  }

  return `K[${parts.join("|")}]`;
}

/**
 * Format decision in native format
 */
export function formatDecisionNative(opts: {
  title: string;
  choice?: string;
  alt?: string;
  why?: string;
  confidence?: number;
  outcome?: string;
}): string {
  const parts = [escapeNativeFormat(opts.title.slice(0, 40))];

  if (opts.choice) {
    parts.push(`choice:${escapeNativeFormat(opts.choice.slice(0, 30))}`);
  }
  if (opts.alt) {
    parts.push(`alt:${escapeNativeFormat(opts.alt.slice(0, 20))}`);
  }
  if (opts.why) {
    parts.push(`why:${escapeNativeFormat(opts.why.slice(0, 40))}`);
  }
  if (opts.confidence !== undefined) {
    parts.push(`conf:${opts.confidence}`);
  }
  if (opts.outcome && opts.outcome !== "pending") {
    parts.push(`out:${escapeNativeFormat(opts.outcome)}`);
  }

  return `D[${parts.join("|")}]`;
}

/**
 * Format issue in native format
 */
export function formatIssueNative(opts: {
  id: number;
  severity: number;
  title: string;
  type?: string;
}): string {
  const parts = [`#${opts.id}`, `sev:${opts.severity}`];

  if (opts.type && opts.type !== "bug") {
    parts.push(`type:${escapeNativeFormat(opts.type)}`);
  }
  parts.push(escapeNativeFormat(opts.title.slice(0, 50)));

  return `I[${parts.join("|")}]`;
}

/**
 * Format blast radius in native format
 */
export function formatBlastNative(opts: {
  score: number;
  direct: number;
  transitive: number;
  tests: number;
  routes?: number;
  risk: "low" | "medium" | "high" | "critical";
}): string {
  const parts = [
    `score:${Math.round(opts.score)}`,
    `direct:${opts.direct}`,
    `trans:${opts.transitive}`,
    `tests:${opts.tests}`,
  ];

  if (opts.routes && opts.routes > 0) {
    parts.push(`routes:${opts.routes}`);
  }
  parts.push(`risk:${opts.risk}`);

  return `B[${parts.join("|")}]`;
}

/**
 * Format relationships in native format
 */
export function formatRelationsNative(opts: {
  cochangers?: string[];
  tests?: string[];
}): string {
  const parts: string[] = [];

  if (opts.cochangers && opts.cochangers.length > 0) {
    parts.push(`cochangers:${opts.cochangers.slice(0, 3).join(",")}`);
  }
  if (opts.tests && opts.tests.length > 0) {
    parts.push(`tests:${opts.tests.slice(0, 3).join(",")}`);
  }

  if (parts.length === 0) return "";
  return `R[${parts.join("|")}]`;
}

/**
 * Format code intelligence in native format
 */
export function formatCodeIntelNative(opts: {
  file: string;
  exports: number;
  callers: number;
  callerFiles: number;
  tests: number;
  topCallers?: string[];
}): string {
  const parts = [
    escapeNativeFormat(opts.file),
    `exports:${opts.exports}`,
    `callers:${opts.callers} in ${opts.callerFiles} files`,
    `tests:${opts.tests}`,
  ];

  if (opts.topCallers && opts.topCallers.length > 0) {
    parts.push(`top:${opts.topCallers.slice(0, 3).map(escapeNativeFormat).join(",")}`);
  }

  return `CI[${parts.join("|")}]`;
}

/**
 * Format blocking message
 */
export function formatBlocked(opts: {
  level: BlockLevel;
  reason: string;
  file?: string;
  fragility?: number;
  operationId?: string;
}): string {
  const lines: string[] = [];

  const levelLabel = opts.level === "hard" ? "BLOCKED" : opts.level === "soft" ? "APPROVAL REQUIRED" : "WARNING";
  lines.push(`!${levelLabel}: ${opts.reason}`);

  if (opts.file) {
    lines.push(`File: ${opts.file}`);
  }
  if (opts.fragility !== undefined) {
    lines.push(`Fragility: ${opts.fragility}/10`);
  }

  if (opts.level === "soft") {
    lines.push("");
    lines.push("To proceed: Explain your modification approach in your next message.");
  } else if (opts.level === "hard" && opts.operationId) {
    lines.push("");
    lines.push(`To proceed: muninn approve ${opts.operationId}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Result Assembly
// ============================================================================

/**
 * Combine enricher outputs into final result
 */
export function assembleResult(
  outputs: EnricherOutput[],
  metrics: { latencyMs: number; cacheHits: number; cacheMisses: number }
): EnrichmentResult {
  // Sort by priority (lower = first)
  const sorted = [...outputs].sort((a, b) => a.priority - b.priority);

  // Check for any blockers
  const blocker = sorted.find((o) => o.blocked && o.blocked.level !== "none");

  // Build context string
  const contextParts: string[] = [];

  if (blocker?.blocked) {
    contextParts.push(
      formatBlocked({
        level: blocker.blocked.level,
        reason: blocker.blocked.reason,
        operationId: blocker.blocked.operationId,
      })
    );
    contextParts.push("");
  }

  // Add non-empty enricher content
  for (const output of sorted) {
    if (output.content?.trim()) {
      contextParts.push(output.content);
    }
  }

  const context = contextParts.join("\n");
  const totalTokens = estimateTokens(context);

  return {
    context,
    totalTokens,
    enrichersUsed: sorted.filter((o) => o.content).map((o) => o.name),
    blocked: blocker?.blocked
      ? {
          level: blocker.blocked.level,
          reason: blocker.blocked.reason,
          operationId: blocker.blocked.operationId || "",
          file: undefined,
        }
      : undefined,
    metrics,
  };
}

/**
 * Format the final enrichment header
 */
export function formatEnrichmentHeader(): string {
  return "## Muninn Context (auto-injected)";
}

/**
 * Wrap enrichment output with header if content exists
 */
export function wrapEnrichmentOutput(result: EnrichmentResult): string {
  if (!result.context || result.totalTokens === 0) {
    return "";
  }

  return `${formatEnrichmentHeader()}\n${result.context}`;
}
