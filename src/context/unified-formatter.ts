/**
 * Unified Context Formatter — v7 Phase 1A
 *
 * Formats UnifiedContextResult into the compact native format
 * within the token budget.
 */

import type { UnifiedContextResult, ContextWarning, ContextKnowledge, ContextFileInfo } from "./unified-router";
import { estimateTokens } from "../enrichment/formatter";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BUDGET = 2000;

// ============================================================================
// Formatter
// ============================================================================

/**
 * Format unified context result into compact native output.
 * Sections are ordered by priority: warnings > context > files.
 */
export function formatUnifiedContext(
  result: UnifiedContextResult,
  budget: number = DEFAULT_BUDGET,
): string {
  const sections: string[] = [];
  let tokensUsed = 0;

  // 1. Warnings (highest priority)
  if (result.warnings.length > 0) {
    const warningSection = formatWarnings(result.warnings);
    const tokens = estimateTokens(warningSection);
    if (tokensUsed + tokens <= budget) {
      sections.push(warningSection);
      tokensUsed += tokens;
    }
  }

  // 2. Strategies (between warnings and knowledge)
  const strategies = result.context.filter((k) => k.type === "strategy");
  if (strategies.length > 0) {
    const strategySection = formatStrategies(strategies, budget - tokensUsed);
    if (strategySection) {
      const tokens = estimateTokens(strategySection);
      sections.push(strategySection);
      tokensUsed += tokens;
    }
  }

  // 3. Context knowledge (decisions, learnings, error fixes, issues)
  const nonStrategyContext = result.context.filter((k) => k.type !== "strategy");
  if (nonStrategyContext.length > 0) {
    const contextSection = formatKnowledge(nonStrategyContext, budget - tokensUsed);
    if (contextSection) {
      const tokens = estimateTokens(contextSection);
      sections.push(contextSection);
      tokensUsed += tokens;
    }
  }

  // 3. Files
  if (result.files.length > 0) {
    const fileSection = formatFiles(result.files, budget - tokensUsed);
    if (fileSection) {
      const tokens = estimateTokens(fileSection);
      sections.push(fileSection);
      tokensUsed += tokens;
    }
  }

  result.meta.tokensUsed = tokensUsed;

  if (sections.length === 0) {
    return "No relevant context found.";
  }

  return sections.join("\n\n");
}

// ============================================================================
// Section Formatters
// ============================================================================

function formatWarnings(warnings: ContextWarning[]): string {
  // Sort: critical first, then warning, then info
  const sorted = [...warnings].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  const lines = ["WARNINGS:"];
  for (const w of sorted.slice(0, 10)) {
    const icon = w.severity === "critical" ? "!!" : w.severity === "warning" ? "!" : "-";
    const file = w.file ? ` [${w.file}]` : "";
    lines.push(`  ${icon} ${w.message}${file}`);
  }
  return lines.join("\n");
}

function formatKnowledge(knowledge: ContextKnowledge[], budget: number): string | null {
  if (budget <= 0) return null;

  // Group by type
  const decisions = knowledge.filter((k) => k.type === "decision");
  const learnings = knowledge.filter((k) => k.type === "learning");
  const errorFixes = knowledge.filter((k) => k.type === "error_fix");
  const issues = knowledge.filter((k) => k.type === "issue");

  const lines: string[] = [];
  let tokensUsed = 0;

  // Decisions
  if (decisions.length > 0) {
    lines.push("CONTEXT:");
    for (const d of decisions.slice(0, 5)) {
      const status = d.status && d.status !== "pending" ? ` [${d.status}]` : "";
      const line = `  D[${d.title.slice(0, 50)}${status}]`;
      const tokens = estimateTokens(line);
      if (tokensUsed + tokens > budget) break;
      lines.push(line);
      tokensUsed += tokens;
    }
  }

  // Learnings
  for (const l of learnings.slice(0, 5)) {
    if (lines.length === 0) lines.push("CONTEXT:");
    const conf = l.confidence !== undefined ? `|conf:${l.confidence}` : "";
    const line = `  K[${l.title.slice(0, 50)}${conf}]`;
    const tokens = estimateTokens(line);
    if (tokensUsed + tokens > budget) break;
    lines.push(line);
    tokensUsed += tokens;
  }

  // Error fixes
  for (const e of errorFixes.slice(0, 3)) {
    if (lines.length === 0) lines.push("CONTEXT:");
    const line = `  EF[${e.title.slice(0, 30)}|fix:${e.content.slice(0, 50)}]`;
    const tokens = estimateTokens(line);
    if (tokensUsed + tokens > budget) break;
    lines.push(line);
    tokensUsed += tokens;
  }

  // Issues
  for (const i of issues.slice(0, 3)) {
    if (lines.length === 0) lines.push("CONTEXT:");
    const sev = i.confidence !== undefined ? `sev:${i.confidence}|` : "";
    const line = `  I[${sev}${i.title.slice(0, 40)}]`;
    const tokens = estimateTokens(line);
    if (tokensUsed + tokens > budget) break;
    lines.push(line);
    tokensUsed += tokens;
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatStrategies(strategies: ContextKnowledge[], budget: number): string | null {
  if (budget <= 0 || strategies.length === 0) return null;

  const lines = ["STRATEGIES:"];
  let tokensUsed = estimateTokens(lines[0]);

  for (const s of strategies.slice(0, 5)) {
    const rate = s.confidence !== undefined ? `|rate:${s.confidence * 10}%` : "";
    const line = `  ST[${s.title}|${s.content.slice(0, 50)}${rate}]`;
    const tokens = estimateTokens(line);
    if (tokensUsed + tokens > budget) break;
    lines.push(line);
    tokensUsed += tokens;
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatFiles(files: ContextFileInfo[], budget: number): string | null {
  if (budget <= 0) return null;

  const lines = ["FILES:"];
  let tokensUsed = estimateTokens(lines[0]);

  // Sort by fragility descending
  const sorted = [...files].sort((a, b) => b.fragility - a.fragility);

  for (const f of sorted.slice(0, 15)) {
    const parts = [f.path];
    if (f.fragility >= 3) parts.push(`frag:${f.fragility}`);
    if (f.purpose) parts.push(f.purpose.slice(0, 40));
    if (f.historicalFailureRate !== undefined && f.historicalFailureRate > 0) {
      parts.push(`fail:${Math.round(f.historicalFailureRate * 100)}%`);
    }
    if (f.cochangers && f.cochangers.length > 0) {
      parts.push(`co:${f.cochangers.slice(0, 3).join(",")}`);
    }
    if (f.testFiles && f.testFiles.length > 0) {
      parts.push(`tests:${f.testFiles.slice(0, 2).join(",")}`);
    }

    const line = `  F[${parts.join("|")}]`;
    const tokens = estimateTokens(line);
    if (tokensUsed + tokens > budget) break;
    lines.push(line);
    tokensUsed += tokens;
  }

  return lines.length > 1 ? lines.join("\n") : null;
}
