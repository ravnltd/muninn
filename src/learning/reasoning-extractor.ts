/**
 * Reasoning Trace Extractor — v7 Phase 2A
 *
 * Extracts reasoning traces from session tool call sequences.
 * No LLM required — pure heuristic extraction:
 *
 * 1. Problem identification: First meaningful tool call keywords
 * 2. Dead end detection: Backtracking patterns (read A -> read B -> back to A)
 * 3. Hypothesis chain: Clusters of related tool calls that shift domains
 * 4. Breakthrough detection: Last cluster before outcome turns positive
 * 5. Strategy tagging: Pattern matching on tool sequences
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

interface ToolCallRecord {
  id: number;
  tool_name: string;
  input_summary: string | null;
  files_involved: string | null;
  success: number;
  created_at: string;
}

export interface ReasoningTrace {
  problemSignature: string;
  hypothesisChain: string[];
  deadEnds: string[];
  breakthrough: string | null;
  strategyTags: string[];
  toolSequence: number[];
  outcome: string;
  durationMs: number;
}

// ============================================================================
// Strategy Patterns
// ============================================================================

interface StrategyPattern {
  name: string;
  pattern: RegExp;
  description: string;
}

const STRATEGY_PATTERNS: StrategyPattern[] = [
  {
    name: "review-before-edit",
    pattern: /check.*query.*check.*file_add/,
    description: "Check context, query memory, re-check, then modify",
  },
  {
    name: "error-driven-fix",
    pattern: /query.*error.*check.*file_add/,
    description: "Search for error context, check file, apply fix",
  },
  {
    name: "broad-exploration",
    pattern: /suggest.*check.*check.*check/,
    description: "Suggest files, check multiple before acting",
  },
  {
    name: "quick-fix",
    pattern: /check.*file_add/,
    description: "Minimal check then direct modification",
  },
  {
    name: "deep-research",
    pattern: /query.*query.*query/,
    description: "Multiple queries to build understanding",
  },
  {
    name: "context-first",
    pattern: /context.*file_add/,
    description: "Unified context retrieval then edit",
  },
  {
    name: "plan-then-execute",
    pattern: /predict.*suggest.*check.*file_add/,
    description: "Plan with predict/suggest, then execute",
  },
];

// ============================================================================
// Main
// ============================================================================

/**
 * Extract reasoning traces from a session's tool call sequence.
 * Runs at session end as a background job.
 */
export async function extractReasoningTraces(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
): Promise<ReasoningTrace[]> {
  // Get all tool calls for this session
  const toolCalls = await db.all<ToolCallRecord>(
    `SELECT id, tool_name, input_summary, files_involved, success, created_at
     FROM tool_calls
     WHERE session_id = ? AND project_id = ?
     ORDER BY created_at ASC`,
    [sessionId, projectId],
  );

  if (toolCalls.length < 3) return []; // Need minimum sequence to detect patterns

  // Get session outcome
  const session = await db.get<{ success: number | null; outcome: string | null }>(
    `SELECT success, outcome FROM sessions WHERE id = ?`,
    [sessionId],
  );
  const outcomeLabel = session?.success === 2 ? "success" : session?.success === 1 ? "partial" : session?.success === 0 ? "failed" : "unknown";

  // Extract trace from the full session
  const trace = extractTrace(toolCalls, outcomeLabel);
  if (!trace) return [];

  // Persist the trace
  await persistTrace(db, projectId, sessionId, trace);

  return [trace];
}

// ============================================================================
// Extraction Logic
// ============================================================================

function extractTrace(
  calls: ToolCallRecord[],
  outcome: string,
): ReasoningTrace | null {
  if (calls.length === 0) return null;

  // 1. Problem signature: keywords from first 3 meaningful tool calls
  const problemSignature = extractProblemSignature(calls.slice(0, 5));

  // 2. Build tool name sequence for pattern matching
  const toolSequence = calls.map((c) => c.id);
  const toolNames = calls.map((c) => normalizeTool(c.tool_name));
  const toolSeqStr = toolNames.join(",");

  // 3. Detect dead ends (backtracking)
  const deadEnds = detectDeadEnds(calls);

  // 4. Detect hypothesis chain (topic shifts)
  const hypothesisChain = detectHypotheses(calls);

  // 5. Detect breakthrough (last productive cluster)
  const breakthrough = detectBreakthrough(calls, outcome);

  // 6. Strategy tagging
  const strategyTags = detectStrategies(toolSeqStr);

  // 7. Duration
  const firstCall = new Date(calls[0].created_at).getTime();
  const lastCall = new Date(calls[calls.length - 1].created_at).getTime();
  const durationMs = lastCall - firstCall;

  return {
    problemSignature,
    hypothesisChain,
    deadEnds,
    breakthrough,
    strategyTags,
    toolSequence,
    outcome,
    durationMs,
  };
}

function extractProblemSignature(calls: ToolCallRecord[]): string {
  const keywords: string[] = [];
  for (const call of calls) {
    if (call.input_summary) {
      // Extract meaningful words from input summary
      const words = call.input_summary
        .replace(/[^a-zA-Z\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 3);
      keywords.push(...words);
    }
    if (call.files_involved) {
      // Extract file names
      const files = call.files_involved.split(",").map((f) => f.trim().split("/").pop() ?? "");
      keywords.push(...files.filter((f) => f.length > 0));
    }
  }
  // Deduplicate and take top keywords
  const unique = [...new Set(keywords)].slice(0, 5);
  return unique.join(" ") || "unknown";
}

function detectDeadEnds(calls: ToolCallRecord[]): string[] {
  const deadEnds: string[] = [];
  const filesRead: string[] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const files = extractFiles(call);

    // Check if we're revisiting a previously read file (backtracking)
    for (const file of files) {
      const lastIndex = filesRead.lastIndexOf(file);
      if (lastIndex >= 0 && i - lastIndex >= 2) {
        // We went back to a file we read earlier (at least 2 steps gap)
        const middle = calls.slice(lastIndex + 1, i).map((c) => normalizeTool(c.tool_name)).join(",");
        if (middle.length > 0) {
          deadEnds.push(`Backtrack to ${file.split("/").pop()} after: ${middle}`);
        }
      }
    }
    filesRead.push(...files);
  }

  return [...new Set(deadEnds)].slice(0, 5);
}

function detectHypotheses(calls: ToolCallRecord[]): string[] {
  const hypotheses: string[] = [];
  let currentDomain = "";

  for (const call of calls) {
    const domain = extractDomain(call);
    if (domain && domain !== currentDomain) {
      if (currentDomain) {
        hypotheses.push(`Shifted from ${currentDomain} to ${domain}`);
      }
      currentDomain = domain;
    }
  }

  return hypotheses.slice(0, 5);
}

function detectBreakthrough(calls: ToolCallRecord[], outcome: string): string | null {
  if (outcome === "failed") return null;

  // Find the last cluster that includes a file_add (productive change)
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].tool_name === "muninn_file_add" || calls[i].tool_name === "muninn_decision_add") {
      const context = calls.slice(Math.max(0, i - 2), i + 1);
      const summary = context.map((c) => normalizeTool(c.tool_name)).join(" -> ");
      const files = extractFiles(calls[i]);
      const fileStr = files.length > 0 ? ` (${files.join(", ")})` : "";
      return `${summary}${fileStr}`;
    }
  }

  return null;
}

function detectStrategies(toolSeqStr: string): string[] {
  const tags: string[] = [];
  for (const pattern of STRATEGY_PATTERNS) {
    if (pattern.pattern.test(toolSeqStr)) {
      tags.push(pattern.name);
    }
  }
  return tags;
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeTool(name: string): string {
  return name.replace("muninn_", "").replace("muninn", "passthrough");
}

function extractFiles(call: ToolCallRecord): string[] {
  if (call.files_involved) {
    return call.files_involved.split(",").map((f) => f.trim()).filter((f) => f.length > 0);
  }
  return [];
}

function extractDomain(call: ToolCallRecord): string {
  const files = extractFiles(call);
  if (files.length > 0) {
    // Get the directory name
    const parts = files[0].split("/");
    if (parts.length > 1) {
      return parts[parts.length - 2];
    }
  }
  // Fall back to tool name
  return normalizeTool(call.tool_name);
}

// ============================================================================
// Persistence
// ============================================================================

async function persistTrace(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number,
  trace: ReasoningTrace,
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO reasoning_traces
       (project_id, session_id, problem_signature, hypothesis_chain, dead_ends,
        breakthrough, strategy_tags, tool_sequence, outcome, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        sessionId,
        trace.problemSignature,
        JSON.stringify(trace.hypothesisChain),
        JSON.stringify(trace.deadEnds),
        trace.breakthrough,
        JSON.stringify(trace.strategyTags),
        JSON.stringify(trace.toolSequence),
        trace.outcome,
        trace.durationMs,
      ],
    );
  } catch {
    // Table may not exist yet
  }
}
