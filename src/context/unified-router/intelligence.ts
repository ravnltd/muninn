/**
 * Unified Context Router — Intelligence Injection
 *
 * Injects v7 intelligence signals (strategies, staleness, trajectory,
 * predictions, self-awareness) into the context result.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import { collectIntelligence } from "../intelligence-collector.js";
import { getRecentToolNames } from "../shifter.js";
import type { ContextRequest, UnifiedContextResult } from "./types.js";

/**
 * Inject intelligence signals into the context result.
 * Adds strategies, stale tags, trajectory warnings, and predictions.
 */
export async function injectIntelligence(
  db: DatabaseAdapter,
  projectId: number,
  request: ContextRequest,
  result: UnifiedContextResult,
): Promise<void> {
  try {
    const keywords = extractRequestKeywords(request);
    const recentTools = getRecentToolNames();
    const signals = await collectIntelligence(db, projectId, keywords, recentTools);

    // Add matching strategies as context entries
    for (const s of signals.strategies) {
      result.context.push({
        type: "strategy",
        title: s.name,
        content: s.description,
        confidence: Math.round(s.successRate * 10),
      });
    }

    // Tag stale items in existing context
    for (const item of result.context) {
      if (item.type === "decision" || item.type === "learning") {
        for (const staleId of signals.staleItemIds) {
          const [table] = staleId.split(":");
          if ((table === "decisions" && item.type === "decision") ||
              (table === "learnings" && item.type === "learning")) {
            if (!item.title.includes("[stale]")) {
              item.title = `${item.title} [stale]`;
            }
          }
        }
      }
    }

    // Add trajectory warning if stuck or failing
    if ((signals.trajectory.pattern === "stuck" || signals.trajectory.pattern === "failing") &&
        signals.trajectory.confidence > 0.5) {
      result.warnings.push({
        type: "stale",
        severity: signals.trajectory.pattern === "failing" ? "warning" : "info",
        message: `Trajectory: ${signals.trajectory.message}`,
      });
      if (signals.trajectory.suggestion) {
        result.warnings.push({
          type: "stale",
          severity: "info",
          message: signals.trajectory.suggestion,
        });
      }
    }

    // Add prediction if high confidence
    if (signals.prediction && signals.prediction.confidence > 0.7) {
      result.warnings.push({
        type: "stale",
        severity: "info",
        message: `Predicted next: ${signals.prediction.tool} (${Math.round(signals.prediction.confidence * 100)}%)`,
      });
    }

    // Agent self-awareness: warn on low-success task types
    if (signals.profile?.worstTaskType) {
      const { getTaskContext: getCtx } = await import("../task-analyzer.js");
      const currentCtx = getCtx();
      const currentType = currentCtx?.taskType;
      const worst = signals.profile.worstTaskType;
      if (currentType && currentType === worst.type && worst.successRate < 0.5 && worst.total >= 3) {
        const pct = Math.round(worst.successRate * 100);
        let msg = `${worst.type}: ${pct}% success across ${worst.total} sessions`;
        if (signals.profile.bestStrategy && signals.profile.bestStrategy.taskType === worst.type) {
          const s = signals.profile.bestStrategy;
          msg += `. Best strategy: ${s.name} (${Math.round(s.successRate * 100)}%)`;
        }
        result.warnings.push({ type: "stale", severity: "warning", message: msg });
      }
    }

    result.meta.sourcesQueried.push("intelligence");
  } catch {
    // Intelligence collection is best-effort
  }
}

/** Extract keywords from a context request */
export function extractRequestKeywords(request: ContextRequest): string[] {
  const keywords: string[] = [];
  if (request.query) {
    keywords.push(...request.query.split(/\s+/).filter((w) => w.length >= 3).slice(0, 5));
  }
  if (request.task) {
    keywords.push(...request.task.split(/\s+/).filter((w) => w.length >= 3).slice(0, 5));
  }
  if (request.files) {
    for (const f of request.files.slice(0, 3)) {
      const basename = f.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
      if (basename.length >= 3) keywords.push(basename);
    }
  }
  return [...new Set(keywords)];
}
