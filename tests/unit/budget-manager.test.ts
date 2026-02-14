/**
 * Tests for budget-manager: weight adjustments, scoring, budget caps, empty context
 */

import { describe, expect, test } from "bun:test";
import { buildContextOutput, applyWeightAdjustments } from "../../src/context/budget-manager";
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
    analyzedAt: Date.now(),
    ...overrides,
  };
}

describe("applyWeightAdjustments", () => {
  const defaultAlloc = {
    criticalWarnings: 400,
    decisions: 400,
    learnings: 400,
    fileContext: 400,
    errorFixes: 200,
    reserve: 200,
  };

  test("returns unchanged allocation with empty weights", () => {
    const result = applyWeightAdjustments(defaultAlloc, {});
    expect(result).toEqual(defaultAlloc);
  });

  test("applies prediction weight to fileContext", () => {
    const result = applyWeightAdjustments(defaultAlloc, { prediction: 1.2 });
    expect(result.fileContext).toBe(480);
    // Other categories unchanged
    expect(result.decisions).toBe(400);
    expect(result.learnings).toBe(400);
  });

  test("applies suggestion weight to fileContext", () => {
    const result = applyWeightAdjustments(defaultAlloc, { suggestion: 0.8 });
    expect(result.fileContext).toBe(320);
  });

  test("prediction takes priority over suggestion for fileContext", () => {
    const result = applyWeightAdjustments(defaultAlloc, { prediction: 1.2, suggestion: 0.8 });
    expect(result.fileContext).toBe(480);
  });

  test("applies enrichment weight to all non-file categories", () => {
    const result = applyWeightAdjustments(defaultAlloc, { enrichment: 1.2 });
    expect(result.criticalWarnings).toBe(480);
    expect(result.decisions).toBe(480);
    expect(result.learnings).toBe(480);
    expect(result.errorFixes).toBe(240);
    // fileContext unaffected by enrichment alone
    expect(result.fileContext).toBe(400);
  });

  test("clamps minimum budget to 100", () => {
    const result = applyWeightAdjustments(
      { ...defaultAlloc, errorFixes: 100 },
      { enrichment: 0.5 }
    );
    expect(result.errorFixes).toBe(100); // 100 * 0.5 = 50, clamped to 100
  });

  test("clamps maximum budget to 800", () => {
    const result = applyWeightAdjustments(
      { ...defaultAlloc, decisions: 700 },
      { enrichment: 1.5 }
    );
    expect(result.decisions).toBe(800); // 700 * 1.5 = 1050, clamped to 800
  });
});

describe("buildContextOutput", () => {
  test("returns empty string for context with no data", () => {
    const ctx = makeTaskContext();
    const result = buildContextOutput(ctx);
    expect(result).toBe("");
  });

  test("includes fragile files in critical warnings", () => {
    const ctx = makeTaskContext({
      relevantFiles: [
        { path: "src/danger.ts", fragility: 9, purpose: "dangerous file", score: 0.8 },
      ],
    });
    const result = buildContextOutput(ctx);
    expect(result).toContain("Fragile files");
    expect(result).toContain("src/danger.ts");
  });

  test("includes failed decisions as critical warnings", () => {
    const ctx = makeTaskContext({
      relevantDecisions: [
        { id: 1, title: "Bad choice", decision: "Did X", outcomeStatus: "failed", score: 0.5 },
      ],
    });
    const result = buildContextOutput(ctx);
    expect(result).toContain("Failed decisions");
    expect(result).toContain("Bad choice");
  });

  test("includes learnings with category and confidence", () => {
    const ctx = makeTaskContext({
      relevantLearnings: [
        { id: 1, category: "gotcha", title: "Watch out", content: "Be careful", confidence: 8, score: 0.6 },
      ],
    });
    const result = buildContextOutput(ctx);
    expect(result).toContain("gotcha");
    expect(result).toContain("Watch out");
  });

  test("includes open issues", () => {
    const ctx = makeTaskContext({
      relevantIssues: [
        { id: 42, title: "Memory leak", severity: 8, type: "bug", score: 0.7 },
      ],
    });
    const result = buildContextOutput(ctx);
    expect(result).toContain("Memory leak");
    expect(result).toContain("#42");
  });

  test("respects total budget limit", () => {
    const ctx = makeTaskContext({
      relevantLearnings: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        category: "pattern",
        title: `Learning ${i} with a relatively long title to use more tokens`,
        content: "Important content",
        confidence: 7,
        score: 0.6,
      })),
    });
    const result = buildContextOutput(ctx, 200);
    // With 200 token budget, should be much shorter than all 50 items
    expect(result.length).toBeLessThan(5000);
  });

  test("accepts custom allocation", () => {
    const ctx = makeTaskContext({
      relevantFiles: [
        { path: "src/a.ts", fragility: 3, purpose: "test", score: 0.5 },
      ],
      relevantLearnings: [
        { id: 1, category: "pattern", title: "Test", content: "content", confidence: 7, score: 0.6 },
      ],
    });
    // Give all budget to learnings, none to files
    const allocation = {
      criticalWarnings: 0,
      decisions: 0,
      learnings: 2000,
      fileContext: 0,
      errorFixes: 0,
      reserve: 0,
    };
    const result = buildContextOutput(ctx, 2000, allocation);
    expect(result).toContain("Test");
  });
});
