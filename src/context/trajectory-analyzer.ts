/**
 * Session Trajectory Analyzer — v7 Phase 3B
 *
 * Analyzes early session signals to predict outcome trajectory.
 * Lightweight: ~1ms pattern matching on in-memory recentCalls.
 *
 * Patterns:
 * - 5+ reads, 0 writes in first 10 calls = "exploration phase"
 * - check -> file_add within 3 calls = "confident workflow"
 * - Error events in first 5 calls = "failure trajectory"
 * - Same file checked 3+ times = "agent may be stuck"
 */

// ============================================================================
// Types
// ============================================================================

export type TrajectoryPattern =
  | "exploration"
  | "confident"
  | "failing"
  | "stuck"
  | "normal";

export interface TrajectoryAnalysis {
  pattern: TrajectoryPattern;
  message: string;
  confidence: number;
  suggestion?: string;
}

// ============================================================================
// Analysis
// ============================================================================

/**
 * Analyze session trajectory from recent tool calls.
 * Called from context refreshes and briefing resource.
 */
export function analyzeTrajectory(
  recentCalls: Array<{ toolName: string; files: string[] }>,
): TrajectoryAnalysis {
  if (recentCalls.length < 3) {
    return { pattern: "normal", message: "Too early to analyze", confidence: 0 };
  }

  // Check for stuck pattern (same file checked 3+ times)
  const stuckAnalysis = detectStuckPattern(recentCalls);
  if (stuckAnalysis) return stuckAnalysis;

  // Check for failing trajectory (errors early)
  const failingAnalysis = detectFailingTrajectory(recentCalls);
  if (failingAnalysis) return failingAnalysis;

  // Check for exploration phase (many reads, no writes)
  const explorationAnalysis = detectExplorationPhase(recentCalls);
  if (explorationAnalysis) return explorationAnalysis;

  // Check for confident workflow (quick check -> edit)
  const confidentAnalysis = detectConfidentWorkflow(recentCalls);
  if (confidentAnalysis) return confidentAnalysis;

  return { pattern: "normal", message: "Normal workflow", confidence: 0.5 };
}

// ============================================================================
// Pattern Detectors
// ============================================================================

function detectStuckPattern(
  calls: Array<{ toolName: string; files: string[] }>,
): TrajectoryAnalysis | null {
  // Count file check frequencies
  const fileCheckCounts = new Map<string, number>();
  for (const call of calls) {
    if (call.toolName === "muninn_check" || call.toolName === "muninn_context") {
      for (const file of call.files) {
        fileCheckCounts.set(file, (fileCheckCounts.get(file) ?? 0) + 1);
      }
    }
  }

  for (const [file, count] of fileCheckCounts) {
    if (count >= 3) {
      return {
        pattern: "stuck",
        message: `${file.split("/").pop()} checked ${count} times — agent may be stuck`,
        confidence: 0.7,
        suggestion: "Consider alternative approaches or broader exploration",
      };
    }
  }

  return null;
}

function detectFailingTrajectory(
  calls: Array<{ toolName: string; files: string[] }>,
): TrajectoryAnalysis | null {
  // Check first 5 calls for error-related patterns
  const early = calls.slice(0, 5);
  const errorCalls = early.filter(
    (c) =>
      c.toolName === "muninn_issue" ||
      c.toolName.includes("error") ||
      c.files.some((f) => f.includes("error")),
  );

  if (errorCalls.length >= 2) {
    return {
      pattern: "failing",
      message: "Multiple error signals early in session",
      confidence: 0.6,
      suggestion: "Consider querying for known error fixes before proceeding",
    };
  }

  return null;
}

function detectExplorationPhase(
  calls: Array<{ toolName: string; files: string[] }>,
): TrajectoryAnalysis | null {
  if (calls.length < 5) return null;

  const firstCalls = calls.slice(0, 10);
  const readTools = new Set([
    "muninn_query", "muninn_check", "muninn_predict",
    "muninn_suggest", "muninn_enrich", "muninn_context",
  ]);
  const writeTools = new Set(["muninn_file_add", "muninn_decision_add", "muninn_learn_add"]);

  const reads = firstCalls.filter((c) => readTools.has(c.toolName)).length;
  const writes = firstCalls.filter((c) => writeTools.has(c.toolName)).length;

  if (reads >= 5 && writes === 0) {
    return {
      pattern: "exploration",
      message: `${reads} reads, 0 writes — exploration phase`,
      confidence: 0.6,
      suggestion: "May need more directed context. Try muninn_context with plan intent.",
    };
  }

  return null;
}

function detectConfidentWorkflow(
  calls: Array<{ toolName: string; files: string[] }>,
): TrajectoryAnalysis | null {
  // Check for check -> file_add pattern within first few calls
  for (let i = 0; i < Math.min(calls.length - 1, 5); i++) {
    if (
      (calls[i].toolName === "muninn_check" || calls[i].toolName === "muninn_context") &&
      calls[i + 1]?.toolName === "muninn_file_add"
    ) {
      return {
        pattern: "confident",
        message: "Quick check-then-edit pattern — agent knows what to do",
        confidence: 0.7,
      };
    }
  }

  return null;
}
