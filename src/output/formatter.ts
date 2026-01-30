/**
 * Centralized Dual-Mode Output Formatter
 *
 * Provides both native (transformer-optimized) and human-readable output formats.
 * Reads config once at startup and uses appropriate formatter throughout.
 *
 * Native format reference:
 * - F[path|frag:N|type|purpose|deps]           File
 * - K[type|ent:x,y|when:cond|do:action|conf:N] Learning
 * - D[title|choice:x|alt:y|why:z|conf:N|out:s] Decision
 * - I[#id|sev:N|type|title]                    Issue
 * - B[score:N|direct:N|trans:N|tests:N|risk:l] Blast radius
 * - R[cochangers:a,b|tests:c,d]                Relations
 * - S[#id|goal:x|outcome:y|next:z|ago:time]    Session
 * - P[key|val:x|conf:N]                        Profile
 */

import { isNativeFormat } from "../config/index.js";
import {
  formatFileNative,
  formatLearningNative,
  formatDecisionNative,
  formatIssueNative,
  formatRelationsNative,
} from "../enrichment/formatter.js";

// ============================================================================
// String Escaping (reused from enrichment/formatter.ts)
// ============================================================================

function escapeNativeFormat(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// ============================================================================
// Session Format
// ============================================================================

export interface SessionData {
  id: number;
  goal?: string | null;
  outcome?: string | null;
  nextSteps?: string | null;
  timeAgo: string;
  isOngoing?: boolean;
}

export function formatSession(data: SessionData): string {
  if (isNativeFormat()) {
    return formatSessionNative(data);
  }
  return formatSessionHuman(data);
}

function formatSessionNative(data: SessionData): string {
  const parts = [`#${data.id}`];

  if (data.goal) {
    parts.push(`goal:${escapeNativeFormat(data.goal.slice(0, 60))}`);
  }
  if (data.outcome) {
    parts.push(`outcome:${escapeNativeFormat(data.outcome.slice(0, 40))}`);
  }
  if (data.nextSteps) {
    parts.push(`next:${escapeNativeFormat(data.nextSteps.slice(0, 40))}`);
  }
  parts.push(`ago:${data.timeAgo}`);
  if (data.isOngoing) {
    parts.push("ongoing");
  }

  return `S[${parts.join("|")}]`;
}

function formatSessionHuman(data: SessionData): string {
  const lines: string[] = [];
  lines.push(`**Last session:** ${data.timeAgo}${data.isOngoing ? " (still ongoing)" : ""}`);
  lines.push(`**Goal:** ${data.goal || "Not specified"}`);

  if (data.outcome) {
    lines.push(`**Outcome:** ${data.outcome}`);
  }
  if (data.nextSteps) {
    lines.push(`**Next:** ${data.nextSteps}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Profile Format
// ============================================================================

export interface ProfileData {
  key: string;
  value: string;
  confidence: number;
  category?: string;
}

export function formatProfile(data: ProfileData): string {
  if (isNativeFormat()) {
    return formatProfileNative(data);
  }
  return formatProfileHuman(data);
}

function formatProfileNative(data: ProfileData): string {
  const pct = Math.round(data.confidence * 100);
  const parts = [escapeNativeFormat(data.key), `val:${escapeNativeFormat(data.value.slice(0, 60))}`, `conf:${pct}`];
  return `P[${parts.join("|")}]`;
}

function formatProfileHuman(data: ProfileData): string {
  const pct = Math.round(data.confidence * 100);
  return `- ${data.key} (${pct}%): ${data.value.slice(0, 60)}`;
}

// ============================================================================
// File Format (wrapper around enrichment formatter)
// ============================================================================

export interface FileData {
  path: string;
  fragility?: number;
  purpose?: string;
  deps?: number;
  type?: string;
  reason?: string;
}

export function formatFile(data: FileData): string {
  if (isNativeFormat()) {
    return formatFileNative(data);
  }
  return formatFileHuman(data);
}

function formatFileHuman(data: FileData): string {
  const parts: string[] = [`📁 ${data.path}`];
  if (data.fragility !== undefined && data.fragility > 0) {
    parts.push(`(fragility: ${data.fragility}/10)`);
  }
  if (data.purpose) {
    parts.push(`— ${data.purpose.slice(0, 60)}`);
  }
  return parts.join(" ");
}

// ============================================================================
// Learning Format (wrapper around enrichment formatter)
// ============================================================================

export interface LearningData {
  id: number;
  title: string;
  content: string;
  category?: string;
  confidence?: number;
  native?: string;
}

export function formatLearning(data: LearningData): string {
  if (isNativeFormat()) {
    // Use pre-computed native format if available
    if (data.native) return data.native;
    return formatLearningNative({
      type: data.category || "learning",
      action: data.content.slice(0, 60),
      confidence: data.confidence,
    });
  }
  return formatLearningHuman(data);
}

function formatLearningHuman(data: LearningData): string {
  return `💡 ${data.title}: ${data.content.slice(0, 60)}`;
}

// ============================================================================
// Decision Format (wrapper around enrichment formatter)
// ============================================================================

export interface DecisionData {
  id: number;
  title: string;
  choice?: string;
  reasoning?: string;
  confidence?: number;
  outcome?: string;
  sessionsSince?: number;
}

export function formatDecision(data: DecisionData): string {
  if (isNativeFormat()) {
    const native = formatDecisionNative({
      title: data.title,
      choice: data.choice,
      why: data.reasoning,
      confidence: data.confidence,
      outcome: data.outcome,
    });
    // Prepend ID if we have it
    return native.replace("D[", `D[#${data.id}|`);
  }
  return formatDecisionHuman(data);
}

function formatDecisionHuman(data: DecisionData): string {
  let line = `📋 D#${data.id}: ${data.title}`;
  if (data.sessionsSince !== undefined) {
    line += ` (${data.sessionsSince} sessions ago)`;
  }
  return line;
}

// ============================================================================
// Issue Format (wrapper around enrichment formatter)
// ============================================================================

export interface IssueData {
  id: number;
  title: string;
  severity: number;
  type?: string;
}

export function formatIssue(data: IssueData): string {
  if (isNativeFormat()) {
    return formatIssueNative(data);
  }
  return formatIssueHuman(data);
}

function formatIssueHuman(data: IssueData): string {
  return `🐛 #${data.id} [sev ${data.severity}]: ${data.title}`;
}

// ============================================================================
// Query Result Format
// ============================================================================

export interface QueryResultData {
  id: number;
  title: string;
  content?: string;
  type: string;
  relevance?: number;
}

export function formatQueryResult(data: QueryResultData, brief = false): string {
  if (isNativeFormat()) {
    return formatQueryResultNative(data);
  }
  return formatQueryResultHuman(data, brief);
}

function formatQueryResultNative(data: QueryResultData): string {
  switch (data.type) {
    case "file":
      return formatFileNative({
        path: data.title,
        fragility: data.relevance ? Math.abs(data.relevance * 10) : undefined,
      });
    case "decision":
      return formatDecisionNative({
        title: data.title,
        choice: data.content?.slice(0, 40),
      });
    case "issue":
      return formatIssueNative({
        id: data.id,
        severity: 5,
        title: data.title,
      });
    case "learning":
    case "global-learning":
      return formatLearningNative({
        type: data.type,
        action: data.content?.slice(0, 60) || data.title,
      });
    default:
      return `K[${data.type}|${escapeNativeFormat(data.title)}]`;
  }
}

function formatQueryResultHuman(data: QueryResultData, brief: boolean): string {
  const typeIcon = getTypeIcon(data.type);

  if (brief) {
    const summary = getBriefSummary(data);
    return `${typeIcon} ${data.title} — ${summary}`;
  }

  const content = data.content?.substring(0, 100) || "";
  const ellipsis = (data.content?.length || 0) > 100 ? "..." : "";

  let line = `${typeIcon} [${data.type}] ${data.title}`;
  if (content) {
    line += `\n   ${content}${ellipsis}`;
  }
  return line;
}

function getTypeIcon(type: string): string {
  switch (type) {
    case "file":
      return "📁";
    case "decision":
      return "📋";
    case "issue":
      return "🐛";
    case "learning":
    case "global-learning":
      return "💡";
    default:
      return "📄";
  }
}

function getBriefSummary(result: QueryResultData): string {
  switch (result.type) {
    case "file":
      return `fragility ${result.relevance ? Math.abs(result.relevance * 10).toFixed(0) : "?"}`;
    case "decision":
      return result.content?.substring(0, 40) || "decision";
    case "issue":
      return result.content?.substring(0, 40) || "issue";
    case "learning":
    case "global-learning":
      return result.content?.substring(0, 40) || "learning";
    default:
      return result.content?.substring(0, 40) || "";
  }
}

// ============================================================================
// Predict Bundle Format
// ============================================================================

export interface PredictBundleData {
  relatedFiles: Array<{ path: string; reason: string; confidence?: number }>;
  cochangingFiles: Array<{ path: string; cochange_count: number }>;
  relevantDecisions: Array<{ id: number; title: string }>;
  openIssues: Array<{ id: number; title: string; severity: number }>;
  applicableLearnings: Array<{ id: number; title: string; content: string; native?: string }>;
  testFiles: Array<{ testPath: string; sourcePath: string }>;
  workflowPattern?: { task_type: string; approach: string } | null;
}

export function formatPredictBundle(data: PredictBundleData): string {
  if (isNativeFormat()) {
    return formatPredictBundleNative(data);
  }
  return formatPredictBundleHuman(data);
}

function formatPredictBundleNative(data: PredictBundleData): string {
  const lines: string[] = [];

  // Files
  for (const f of data.relatedFiles) {
    lines.push(
      formatFileNative({
        path: f.path,
        purpose: f.reason,
      })
    );
  }

  // Co-changers as relations
  if (data.cochangingFiles.length > 0) {
    lines.push(
      formatRelationsNative({
        cochangers: data.cochangingFiles.slice(0, 5).map((f) => f.path),
      })
    );
  }

  // Test files as relations
  if (data.testFiles.length > 0) {
    lines.push(
      formatRelationsNative({
        tests: data.testFiles.slice(0, 3).map((t) => t.testPath),
      })
    );
  }

  // Decisions
  for (const d of data.relevantDecisions) {
    lines.push(formatDecisionNative({ title: d.title }));
  }

  // Issues
  for (const i of data.openIssues) {
    lines.push(formatIssueNative({ id: i.id, severity: i.severity, title: i.title }));
  }

  // Learnings
  for (const l of data.applicableLearnings) {
    if (l.native) {
      lines.push(l.native);
    } else {
      lines.push(
        formatLearningNative({
          type: "learning",
          action: l.content.slice(0, 60),
        })
      );
    }
  }

  // Workflow
  if (data.workflowPattern) {
    lines.push(`W[${escapeNativeFormat(data.workflowPattern.task_type)}|approach:${escapeNativeFormat(data.workflowPattern.approach.slice(0, 60))}]`);
  }

  return lines.join("\n");
}

function formatPredictBundleHuman(data: PredictBundleData): string {
  const lines: string[] = [];

  if (data.relatedFiles.length > 0) {
    lines.push("  📁 Related Files:");
    for (const f of data.relatedFiles) {
      lines.push(`     ${f.path} — ${f.reason}`);
    }
    lines.push("");
  }

  if (data.cochangingFiles.length > 0) {
    lines.push("  🔗 Co-changing Files:");
    for (const f of data.cochangingFiles) {
      lines.push(`     ${f.path} (${f.cochange_count}x together)`);
    }
    lines.push("");
  }

  if (data.relevantDecisions.length > 0) {
    lines.push("  📋 Relevant Decisions:");
    for (const d of data.relevantDecisions) {
      lines.push(`     #${d.id}: ${d.title}`);
    }
    lines.push("");
  }

  if (data.openIssues.length > 0) {
    lines.push("  ⚠️  Open Issues:");
    for (const i of data.openIssues) {
      lines.push(`     #${i.id} [sev ${i.severity}]: ${i.title}`);
    }
    lines.push("");
  }

  if (data.applicableLearnings.length > 0) {
    lines.push("  💡 Applicable Learnings:");
    for (const l of data.applicableLearnings) {
      lines.push(`     ${l.title}: ${l.content.slice(0, 60)}`);
    }
    lines.push("");
  }

  if (data.testFiles.length > 0) {
    lines.push("  🧪 Test Coverage:");
    for (const t of data.testFiles) {
      lines.push(`     ${t.testPath} → ${t.sourcePath}`);
    }
    lines.push("");
  }

  if (data.workflowPattern) {
    lines.push(`  🔄 Workflow: ${data.workflowPattern.task_type}`);
    lines.push(`     ${data.workflowPattern.approach.slice(0, 80)}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Insight Format
// ============================================================================

export interface InsightData {
  id: number;
  type: string;
  title: string;
  content: string;
}

export function formatInsight(data: InsightData): string {
  if (isNativeFormat()) {
    return `N[#${data.id}|type:${escapeNativeFormat(data.type)}|${escapeNativeFormat(data.title.slice(0, 40))}]`;
  }
  return `  - [${data.type}] ${data.title}: ${data.content.slice(0, 80)}`;
}

// ============================================================================
// Hot Context / Active State Format
// ============================================================================

export interface HotContextData {
  files: Array<{ path: string }>;
  decisions: Array<{ title: string }>;
  learnings: Array<{ title: string }>;
}

export function formatHotContext(data: HotContextData): string {
  if (isNativeFormat()) {
    const parts: string[] = [];
    if (data.files.length > 0) {
      parts.push(`files:${data.files.map((f) => escapeNativeFormat(f.path)).join(",")}`);
    }
    if (data.decisions.length > 0) {
      parts.push(`decisions:${data.decisions.map((d) => escapeNativeFormat(d.title.slice(0, 20))).join(",")}`);
    }
    if (data.learnings.length > 0) {
      parts.push(`learnings:${data.learnings.map((l) => escapeNativeFormat(l.title.slice(0, 20))).join(",")}`);
    }
    return parts.length > 0 ? `H[${parts.join("|")}]` : "";
  }

  const lines: string[] = [];
  if (data.files.length > 0) {
    lines.push(`**Files:** ${data.files.map((f) => f.path).join(", ")}`);
  }
  if (data.decisions.length > 0) {
    lines.push(`**Decisions:** ${data.decisions.map((d) => d.title).join(", ")}`);
  }
  if (data.learnings.length > 0) {
    lines.push(`**Learnings:** ${data.learnings.map((l) => l.title).join(", ")}`);
  }
  return lines.join("\n");
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { isNativeFormat } from "../config/index.js";
export {
  formatFileNative,
  formatLearningNative,
  formatDecisionNative,
  formatIssueNative,
  formatRelationsNative,
} from "../enrichment/formatter.js";
