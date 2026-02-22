/**
 * Contradiction Detector
 *
 * Detects when current work contradicts past failed/revised decisions
 * or conflicts with established learnings.
 *
 * Hot path (<20ms): Post-processes existing task analysis results using
 * keyword overlap between current task and failed decisions.
 *
 * Contradictions appear at TOP of context output, before critical warnings.
 */

import type { DatabaseAdapter } from "../database/adapter";
import type { TaskContext } from "./task-analyzer";
import type { SemanticMatch } from "./embedding-cache";

// ============================================================================
// Types
// ============================================================================

export interface Contradiction {
  sourceType: "decision" | "learning";
  sourceId: number;
  title: string;
  summary: string;
  severity: "warning" | "critical";
}

// ============================================================================
// Constants
// ============================================================================

const MAX_CONTRADICTIONS = 3;
const KEYWORD_OVERLAP_THRESHOLD = 2;

// ============================================================================
// Hot Path Detection
// ============================================================================

/**
 * Detect contradictions from task analysis results.
 * Uses keyword overlap with failed/revised decisions.
 * Budget: <20ms since it operates on already-loaded data.
 */
export function detectContradictions(
  taskContext: TaskContext,
  semanticMatches?: SemanticMatch[]
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  // Check failed/revised decisions from FTS results
  for (const decision of taskContext.relevantDecisions) {
    if (decision.outcomeStatus === "failed") {
      contradictions.push({
        sourceType: "decision",
        sourceId: decision.id,
        title: decision.title,
        summary: `Previously tried and FAILED: ${decision.decision.slice(0, 80)}`,
        severity: "critical",
      });
    } else if (decision.outcomeStatus === "revised") {
      contradictions.push({
        sourceType: "decision",
        sourceId: decision.id,
        title: decision.title,
        summary: `Previously REVISED: ${decision.decision.slice(0, 80)}`,
        severity: "warning",
      });
    }
  }

  // Check semantic matches for failed decisions (if available)
  if (semanticMatches) {
    for (const match of semanticMatches) {
      if (match.type !== "decision") continue;
      // Skip if already found via FTS
      if (contradictions.some((c) => c.sourceId === match.id && c.sourceType === "decision")) {
        continue;
      }
      // Only flag high-similarity matches for decisions that we know failed
      // (semantic matches don't carry outcome status, so this is a secondary check)
      if (match.similarity >= 0.7 && match.confidence <= 2) {
        contradictions.push({
          sourceType: "decision",
          sourceId: match.id,
          title: match.title,
          summary: `Semantically similar to a low-confidence decision: ${match.content.slice(0, 80)}`,
          severity: "warning",
        });
      }
    }
  }

  // Sort: critical first, then by source type
  contradictions.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return 0;
  });

  return contradictions.slice(0, MAX_CONTRADICTIONS);
}

/**
 * Deep contradiction detection — runs in worker for more thorough analysis.
 * Checks the full database for failed decisions matching current keywords.
 */
export async function detectDeepContradictions(
  db: DatabaseAdapter,
  projectId: number,
  keywords: string[]
): Promise<Contradiction[]> {
  if (keywords.length === 0) return [];

  const contradictions: Contradiction[] = [];

  try {
    // Search for failed decisions matching any keyword
    const searchQuery = keywords.slice(0, 5).join(" ");
    if (searchQuery.length < 3) return [];

    const failedDecisions = await db.all<{
      id: number;
      title: string;
      decision: string;
      outcome_status: string;
    }>(
      `SELECT id, title, decision, outcome_status FROM decisions
       WHERE project_id = ? AND status = 'active'
       AND outcome_status IN ('failed', 'revised')
       ORDER BY decided_at DESC
       LIMIT 10`,
      [projectId]
    );

    for (const decision of failedDecisions) {
      // Check keyword overlap
      const decisionWords = new Set(
        `${decision.title} ${decision.decision}`
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length >= 3)
      );

      let overlap = 0;
      for (const keyword of keywords) {
        if (decisionWords.has(keyword.toLowerCase())) overlap++;
      }

      if (overlap >= KEYWORD_OVERLAP_THRESHOLD) {
        contradictions.push({
          sourceType: "decision",
          sourceId: decision.id,
          title: decision.title,
          summary: decision.outcome_status === "failed"
            ? `Previously tried and FAILED: ${decision.decision.slice(0, 80)}`
            : `Previously REVISED: ${decision.decision.slice(0, 80)}`,
          severity: decision.outcome_status === "failed" ? "critical" : "warning",
        });
      }
    }
  } catch {
    // Tables might not exist
  }

  return contradictions.slice(0, MAX_CONTRADICTIONS);
}

/**
 * Persist a contradiction alert to the database.
 */
export async function persistContradiction(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number | null,
  contradiction: Contradiction,
  currentAction: string
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO contradiction_alerts
       (project_id, session_id, source_type, source_id, current_action, contradiction_summary, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        sessionId,
        contradiction.sourceType,
        contradiction.sourceId,
        currentAction.slice(0, 200),
        contradiction.summary.slice(0, 500),
        contradiction.severity,
      ]
    );
  } catch {
    // Table might not exist
  }
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Format contradictions for context output.
 */
export function serializeContradictions(contradictions: Contradiction[]): string {
  if (contradictions.length === 0) return "";

  const lines = ["CONTRADICTIONS DETECTED:"];
  for (const c of contradictions) {
    const prefix = c.severity === "critical" ? "!! " : "!  ";
    lines.push(`${prefix}${c.summary}`);
  }
  return lines.join("\n");
}
