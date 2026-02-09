/**
 * Token Budget Manager
 *
 * Allocates a 2000-token budget across context types.
 * Scores items by relevance, recency, severity, and confidence.
 * Serializes top items per category until budget exhausted.
 */

import type { TaskContext, RelevantFile, RelevantDecision, RelevantLearning, RelevantIssue, ErrorFix } from "./task-analyzer";
import { estimateTokens } from "../enrichment/formatter";

// ============================================================================
// Types
// ============================================================================

interface BudgetAllocation {
  criticalWarnings: number;
  decisions: number;
  learnings: number;
  fileContext: number;
  errorFixes: number;
  reserve: number;
}

interface ContextSection {
  type: string;
  content: string;
  tokens: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TOTAL_BUDGET = 2000;

const DEFAULT_ALLOCATION: BudgetAllocation = {
  criticalWarnings: 400,
  decisions: 400,
  learnings: 400,
  fileContext: 400,
  errorFixes: 200,
  reserve: 200,
};

// ============================================================================
// Scoring
// ============================================================================

/** Score a file for relevance to current task */
function scoreFile(file: RelevantFile): number {
  let score = file.score;

  // Boost fragile files (higher fragility = more important to show)
  if (file.fragility >= 7) score += 0.3;
  if (file.fragility >= 9) score += 0.2;

  return score;
}

/** Score a decision for relevance */
function scoreDecision(decision: RelevantDecision): number {
  let score = decision.score;

  // Failed decisions are critical warnings
  if (decision.outcomeStatus === "failed") score += 0.5;
  if (decision.outcomeStatus === "revised") score += 0.2;

  return score;
}

/** Score a learning for relevance */
function scoreLearning(learning: RelevantLearning): number {
  let score = learning.score;

  // Higher confidence = more reliable
  score += (learning.confidence / 10) * 0.3;

  // Gotchas are extra important
  if (learning.category === "gotcha") score += 0.3;

  return score;
}

/** Score an issue for relevance */
function scoreIssue(issue: RelevantIssue): number {
  let score = issue.score;

  // Higher severity = more important
  score += (issue.severity / 10) * 0.4;

  // Security issues get boosted
  if (issue.type === "security") score += 0.3;

  return score;
}

// ============================================================================
// Serialization
// ============================================================================

/** Format a file entry compactly */
function serializeFile(file: RelevantFile): string {
  const parts = [file.path];
  if (file.fragility >= 5) parts.push(`frag:${file.fragility}`);
  if (file.purpose) parts.push(file.purpose.slice(0, 40));
  return `  F[${parts.join("|")}]`;
}

/** Format a decision entry compactly */
function serializeDecision(decision: RelevantDecision): string {
  const prefix = decision.outcomeStatus === "failed" ? "!! " : "";
  const outcome = decision.outcomeStatus !== "pending" ? ` [${decision.outcomeStatus}]` : "";
  return `  ${prefix}D[${decision.title.slice(0, 40)}${outcome}]`;
}

/** Format a learning entry compactly */
function serializeLearning(learning: RelevantLearning): string {
  return `  K[${learning.category}|${learning.title.slice(0, 50)}|conf:${learning.confidence}]`;
}

/** Format an issue entry compactly */
function serializeIssue(issue: RelevantIssue): string {
  return `  I[#${issue.id}|sev:${issue.severity}|${issue.title.slice(0, 40)}]`;
}

/** Format an error fix entry compactly */
function serializeErrorFix(fix: ErrorFix): string {
  const desc = fix.fixDescription ? fix.fixDescription.slice(0, 50) : "see fix files";
  return `  EF[${fix.signature.slice(0, 30)}|fix:${desc}]`;
}

// ============================================================================
// Budget Allocation
// ============================================================================

/** Fit items into a token budget, returning serialized lines */
function fitToBudget<T>(
  items: T[],
  budget: number,
  scorer: (item: T) => number,
  serializer: (item: T) => string
): string[] {
  // Score and sort
  const scored = items.map((item) => ({
    item,
    score: scorer(item),
    serialized: serializer(item),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Take items until budget exhausted
  const lines: string[] = [];
  let tokensUsed = 0;

  for (const { serialized } of scored) {
    const tokens = estimateTokens(serialized);
    if (tokensUsed + tokens > budget) break;
    lines.push(serialized);
    tokensUsed += tokens;
  }

  return lines;
}

/**
 * Build context output from task context within token budget.
 * Returns formatted string ready for injection.
 */
export function buildContextOutput(
  taskContext: TaskContext,
  totalBudget: number = DEFAULT_TOTAL_BUDGET,
  allocation: BudgetAllocation = DEFAULT_ALLOCATION
): string {
  const sections: ContextSection[] = [];

  // 1. Critical warnings (fragile files + failed decisions)
  const criticalFiles = taskContext.relevantFiles.filter((f) => f.fragility >= 7);
  const failedDecisions = taskContext.relevantDecisions.filter((d) => d.outcomeStatus === "failed");

  if (criticalFiles.length > 0 || failedDecisions.length > 0) {
    const warningLines: string[] = [];
    const halfBudget = Math.floor(allocation.criticalWarnings / 2);

    if (criticalFiles.length > 0) {
      warningLines.push("Fragile files in scope:");
      warningLines.push(...fitToBudget(criticalFiles, halfBudget, scoreFile, serializeFile));
    }
    if (failedDecisions.length > 0) {
      warningLines.push("Failed decisions (avoid repeating):");
      warningLines.push(...fitToBudget(failedDecisions, halfBudget, scoreDecision, serializeDecision));
    }

    const content = warningLines.join("\n");
    sections.push({ type: "warnings", content, tokens: estimateTokens(content) });
  }

  // 2. Relevant decisions (non-failed)
  const activeDecisions = taskContext.relevantDecisions.filter((d) => d.outcomeStatus !== "failed");
  if (activeDecisions.length > 0) {
    const lines = ["Relevant decisions:"];
    lines.push(...fitToBudget(activeDecisions, allocation.decisions, scoreDecision, serializeDecision));
    const content = lines.join("\n");
    sections.push({ type: "decisions", content, tokens: estimateTokens(content) });
  }

  // 3. Relevant learnings
  if (taskContext.relevantLearnings.length > 0) {
    const lines = ["Relevant knowledge:"];
    lines.push(...fitToBudget(taskContext.relevantLearnings, allocation.learnings, scoreLearning, serializeLearning));
    const content = lines.join("\n");
    sections.push({ type: "learnings", content, tokens: estimateTokens(content) });
  }

  // 4. File context
  const nonCriticalFiles = taskContext.relevantFiles.filter((f) => f.fragility < 7);
  if (nonCriticalFiles.length > 0) {
    const lines = ["Related files:"];
    lines.push(...fitToBudget(nonCriticalFiles, allocation.fileContext, scoreFile, serializeFile));
    const content = lines.join("\n");
    sections.push({ type: "files", content, tokens: estimateTokens(content) });
  }

  // 5. Open issues
  if (taskContext.relevantIssues.length > 0) {
    const lines = ["Open issues:"];
    lines.push(...fitToBudget(taskContext.relevantIssues, allocation.reserve, scoreIssue, serializeIssue));
    const content = lines.join("\n");
    sections.push({ type: "issues", content, tokens: estimateTokens(content) });
  }

  // 6. Error fixes (only for bugfix tasks)
  if (taskContext.errorFixes.length > 0) {
    const lines = ["Known error fixes:"];
    lines.push(
      ...fitToBudget(
        taskContext.errorFixes,
        allocation.errorFixes,
        (f) => f.confidence,
        serializeErrorFix
      )
    );
    const content = lines.join("\n");
    sections.push({ type: "error_fixes", content, tokens: estimateTokens(content) });
  }

  // Assemble within total budget
  let totalTokens = 0;
  const outputParts: string[] = [];

  for (const section of sections) {
    if (totalTokens + section.tokens > totalBudget) break;
    outputParts.push(section.content);
    totalTokens += section.tokens;
  }

  if (outputParts.length === 0) return "";

  return outputParts.join("\n\n");
}

/**
 * Get context sections with metadata (for context_injections tracking).
 */
export function getContextSections(
  taskContext: TaskContext,
  totalBudget: number = DEFAULT_TOTAL_BUDGET
): ContextSection[] {
  const output = buildContextOutput(taskContext, totalBudget);
  if (!output) return [];

  // Parse sections back out (each separated by double newline)
  return output.split("\n\n").map((content) => ({
    type: content.split(":")[0]?.toLowerCase().replace(/\s+/g, "_") || "unknown",
    content,
    tokens: estimateTokens(content),
  }));
}
