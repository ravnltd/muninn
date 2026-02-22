/**
 * Tests for v5 Phase 4: Contradiction Detector
 *
 * Tests hot-path contradiction detection from task context.
 */

import { describe, expect, test } from "bun:test";
import {
  detectContradictions,
  serializeContradictions,
} from "../../src/context/contradiction-detector";
import type { TaskContext } from "../../src/context/task-analyzer";

function makeTaskContext(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    taskType: "bugfix",
    domains: [],
    keywords: [],
    files: [],
    relevantFiles: [],
    relevantDecisions: [],
    relevantLearnings: [],
    relevantIssues: [],
    errorFixes: [],
    contradictions: [],
    analyzedAt: Date.now(),
    ...overrides,
  };
}

describe("detectContradictions", () => {
  test("returns empty for context with no decisions", () => {
    const ctx = makeTaskContext();
    const result = detectContradictions(ctx);
    expect(result).toEqual([]);
  });

  test("returns empty for active (non-failed) decisions", () => {
    const ctx = makeTaskContext({
      relevantDecisions: [
        { id: 1, title: "Good choice", decision: "Use TypeScript", outcomeStatus: "pending", score: 0.5 },
        { id: 2, title: "Another choice", decision: "Use Zod", outcomeStatus: "succeeded", score: 0.6 },
      ],
    });
    const result = detectContradictions(ctx);
    expect(result).toEqual([]);
  });

  test("detects failed decisions as critical contradictions", () => {
    const ctx = makeTaskContext({
      relevantDecisions: [
        { id: 1, title: "Bad approach", decision: "Use raw SQL queries", outcomeStatus: "failed", score: 0.8 },
      ],
    });
    const result = detectContradictions(ctx);
    expect(result.length).toBe(1);
    expect(result[0].severity).toBe("critical");
    expect(result[0].sourceType).toBe("decision");
    expect(result[0].sourceId).toBe(1);
    expect(result[0].summary).toContain("FAILED");
  });

  test("detects revised decisions as warnings", () => {
    const ctx = makeTaskContext({
      relevantDecisions: [
        { id: 2, title: "Old approach", decision: "Use REST instead of GraphQL", outcomeStatus: "revised", score: 0.6 },
      ],
    });
    const result = detectContradictions(ctx);
    expect(result.length).toBe(1);
    expect(result[0].severity).toBe("warning");
    expect(result[0].summary).toContain("REVISED");
  });

  test("critical contradictions sorted before warnings", () => {
    const ctx = makeTaskContext({
      relevantDecisions: [
        { id: 1, title: "Revised", decision: "Old way", outcomeStatus: "revised", score: 0.5 },
        { id: 2, title: "Failed", decision: "Bad way", outcomeStatus: "failed", score: 0.5 },
      ],
    });
    const result = detectContradictions(ctx);
    expect(result.length).toBe(2);
    expect(result[0].severity).toBe("critical");
    expect(result[1].severity).toBe("warning");
  });

  test("limits to MAX_CONTRADICTIONS (3)", () => {
    const ctx = makeTaskContext({
      relevantDecisions: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        title: `Failed decision ${i}`,
        decision: `Bad approach ${i}`,
        outcomeStatus: "failed" as const,
        score: 0.5,
      })),
    });
    const result = detectContradictions(ctx);
    expect(result.length).toBe(3);
  });

  test("handles mixed decision statuses", () => {
    const ctx = makeTaskContext({
      relevantDecisions: [
        { id: 1, title: "Active", decision: "Good choice", outcomeStatus: "pending", score: 0.5 },
        { id: 2, title: "Failed", decision: "Bad choice", outcomeStatus: "failed", score: 0.8 },
        { id: 3, title: "Succeeded", decision: "Great choice", outcomeStatus: "succeeded", score: 0.7 },
      ],
    });
    const result = detectContradictions(ctx);
    expect(result.length).toBe(1);
    expect(result[0].sourceId).toBe(2);
  });
});

describe("serializeContradictions", () => {
  test("returns empty string for no contradictions", () => {
    expect(serializeContradictions([])).toBe("");
  });

  test("formats critical with double exclamation", () => {
    const result = serializeContradictions([
      {
        sourceType: "decision",
        sourceId: 1,
        title: "Bad",
        summary: "Previously tried and FAILED: used raw SQL",
        severity: "critical",
      },
    ]);
    expect(result).toContain("CONTRADICTIONS DETECTED:");
    expect(result).toContain("!! ");
    expect(result).toContain("FAILED");
  });

  test("formats warning with single exclamation", () => {
    const result = serializeContradictions([
      {
        sourceType: "decision",
        sourceId: 2,
        title: "Old",
        summary: "Previously REVISED: old approach",
        severity: "warning",
      },
    ]);
    expect(result).toContain("!  ");
    expect(result).toContain("REVISED");
  });
});
