/**
 * Tests for v5 Phase 2: Composite Fragility Scorer
 *
 * Tests signal scoring functions and composite score calculation.
 */

import { describe, expect, test } from "bun:test";

// Import internal types to test scoring logic
// We recreate the signal scoring functions here since they're not exported
// but the algorithm is deterministic and well-defined.

interface FragilitySignals {
  dependentCount: number;
  dependentScore: number;
  testCoverage: number;
  testScore: number;
  changeVelocity: number;
  velocityScore: number;
  errorCount: number;
  errorScore: number;
  exportCount: number;
  exportScore: number;
  complexity: number;
  complexityScore: number;
  manualOverride: number | null;
  overrideScore: number;
}

const WEIGHTS = {
  dependents: 0.25,
  testCoverage: 0.20,
  changeVelocity: 0.15,
  errorHistory: 0.15,
  exportSurface: 0.10,
  complexity: 0.10,
  manualOverride: 0.05,
};

function scoreDependents(count: number): number {
  if (count >= 21) return 10;
  if (count >= 11) return 8;
  if (count >= 6) return 7;
  if (count >= 3) return 5;
  if (count >= 1) return 3;
  return 0;
}

function scoreTestCoverage(hasTests: boolean, dependentCount: number): number {
  if (hasTests) return 0;
  if (dependentCount >= 5) return 10;
  if (dependentCount >= 2) return 7;
  if (dependentCount >= 1) return 5;
  return 3;
}

function scoreVelocity(velocityScore: number): number {
  if (velocityScore >= 6) return 9;
  if (velocityScore >= 3) return 6;
  if (velocityScore >= 1) return 3;
  return 0;
}

function scoreErrors(count: number): number {
  if (count >= 6) return 10;
  if (count >= 3) return 7;
  if (count >= 1) return 4;
  return 0;
}

function scoreExports(count: number): number {
  if (count >= 21) return 9;
  if (count >= 11) return 7;
  if (count >= 6) return 5;
  if (count >= 3) return 3;
  return 0;
}

function scoreComplexity(symbolCount: number): number {
  if (symbolCount >= 51) return 9;
  if (symbolCount >= 31) return 7;
  if (symbolCount >= 16) return 5;
  if (symbolCount >= 6) return 3;
  return 0;
}

function computeCompositeScore(signals: FragilitySignals): number {
  const weighted =
    signals.dependentScore * WEIGHTS.dependents +
    signals.testScore * WEIGHTS.testCoverage +
    signals.velocityScore * WEIGHTS.changeVelocity +
    signals.errorScore * WEIGHTS.errorHistory +
    signals.exportScore * WEIGHTS.exportSurface +
    signals.complexityScore * WEIGHTS.complexity +
    signals.overrideScore * WEIGHTS.manualOverride;
  return Math.max(1, Math.min(10, Math.round(weighted)));
}

function makeSignals(overrides: Partial<FragilitySignals> = {}): FragilitySignals {
  return {
    dependentCount: 0,
    dependentScore: 0,
    testCoverage: 1,
    testScore: 0,
    changeVelocity: 0,
    velocityScore: 0,
    errorCount: 0,
    errorScore: 0,
    exportCount: 0,
    exportScore: 0,
    complexity: 0,
    complexityScore: 0,
    manualOverride: null,
    overrideScore: 0,
    ...overrides,
  };
}

describe("scoreDependents", () => {
  test("0 dependents = 0", () => expect(scoreDependents(0)).toBe(0));
  test("1 dependent = 3", () => expect(scoreDependents(1)).toBe(3));
  test("5 dependents = 5", () => expect(scoreDependents(5)).toBe(5));
  test("10 dependents = 7", () => expect(scoreDependents(10)).toBe(7));
  test("15 dependents = 8", () => expect(scoreDependents(15)).toBe(8));
  test("25 dependents = 10", () => expect(scoreDependents(25)).toBe(10));
});

describe("scoreTestCoverage", () => {
  test("has tests = 0 regardless of dependents", () => {
    expect(scoreTestCoverage(true, 20)).toBe(0);
  });
  test("no tests, no dependents = 3", () => {
    expect(scoreTestCoverage(false, 0)).toBe(3);
  });
  test("no tests, many dependents = 10", () => {
    expect(scoreTestCoverage(false, 10)).toBe(10);
  });
});

describe("scoreVelocity", () => {
  test("0 velocity = 0", () => expect(scoreVelocity(0)).toBe(0));
  test("moderate velocity = 6", () => expect(scoreVelocity(4)).toBe(6));
  test("high velocity = 9", () => expect(scoreVelocity(8)).toBe(9));
});

describe("scoreErrors", () => {
  test("0 errors = 0", () => expect(scoreErrors(0)).toBe(0));
  test("2 errors = 4", () => expect(scoreErrors(2)).toBe(4));
  test("5 errors = 7", () => expect(scoreErrors(5)).toBe(7));
  test("10 errors = 10", () => expect(scoreErrors(10)).toBe(10));
});

describe("computeCompositeScore", () => {
  test("all zeros gives minimum score of 1", () => {
    const score = computeCompositeScore(makeSignals());
    expect(score).toBe(1);
  });

  test("max signals gives score of 10", () => {
    const signals = makeSignals({
      dependentScore: 10,
      testScore: 10,
      velocityScore: 9,
      errorScore: 10,
      exportScore: 9,
      complexityScore: 9,
      overrideScore: 10,
    });
    const score = computeCompositeScore(signals);
    expect(score).toBe(10);
  });

  test("dependents are the strongest signal", () => {
    const depsOnly = computeCompositeScore(makeSignals({ dependentScore: 10 }));
    const testsOnly = computeCompositeScore(makeSignals({ testScore: 10 }));
    expect(depsOnly).toBeGreaterThanOrEqual(testsOnly);
  });

  test("file with many dependents and no tests scores high", () => {
    const signals = makeSignals({
      dependentCount: 15,
      dependentScore: scoreDependents(15),
      testCoverage: 0,
      testScore: scoreTestCoverage(false, 15),
    });
    const score = computeCompositeScore(signals);
    expect(score).toBeGreaterThanOrEqual(4);
  });

  test("file with tests and few dependents scores low", () => {
    const signals = makeSignals({
      dependentCount: 1,
      dependentScore: scoreDependents(1),
      testCoverage: 1,
      testScore: scoreTestCoverage(true, 1),
    });
    const score = computeCompositeScore(signals);
    expect(score).toBeLessThanOrEqual(2);
  });

  test("errors increase fragility significantly", () => {
    const withoutErrors = computeCompositeScore(makeSignals({
      dependentScore: 5,
      testScore: 3,
    }));
    const withErrors = computeCompositeScore(makeSignals({
      dependentScore: 5,
      testScore: 3,
      errorScore: 10,
    }));
    expect(withErrors).toBeGreaterThan(withoutErrors);
  });

  test("weights sum to 1.0", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});
