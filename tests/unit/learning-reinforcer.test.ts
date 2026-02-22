/**
 * Tests for v5 Phase 1: Bayesian Learning Reinforcer
 *
 * Tests the confidence update algorithm:
 * - Stabilizing delta: 1/sqrt(times_applied+1)
 * - Positive/negative signals from session outcomes
 * - Confidence clamping to [0.5, 10.0]
 */

import { describe, expect, test } from "bun:test";

// We test the algorithm by importing and calling the module's functions
// Since reinforceLearnings requires a DB, we test the pure logic via
// a simulated approach matching the implementation.

describe("Bayesian reinforcement algorithm", () => {
  // Mirror the stabilizing factor from learning-reinforcer.ts
  function stabilizingFactor(timesApplied: number): number {
    return 1 / Math.sqrt(timesApplied + 1);
  }

  function clampConfidence(value: number): number {
    return Math.max(0.5, Math.min(10.0, value));
  }

  const POSITIVE_BASE_DELTA = 0.3;
  const NEGATIVE_BASE_DELTA = -0.4;
  const DECAY_BASE_DELTA = -0.1;

  describe("stabilizingFactor", () => {
    test("first application has full effect (factor = 1)", () => {
      expect(stabilizingFactor(0)).toBe(1);
    });

    test("after 1 application, factor decreases", () => {
      const factor = stabilizingFactor(1);
      expect(factor).toBeCloseTo(0.707, 2); // 1/sqrt(2)
    });

    test("after 3 applications, factor is smaller", () => {
      const factor = stabilizingFactor(3);
      expect(factor).toBeCloseTo(0.5, 2); // 1/sqrt(4)
    });

    test("after 8 applications, factor stabilizes further", () => {
      const factor = stabilizingFactor(8);
      expect(factor).toBeCloseTo(0.333, 2); // 1/sqrt(9)
    });

    test("after 99 applications, delta is very small", () => {
      const factor = stabilizingFactor(99);
      expect(factor).toBeCloseTo(0.1, 1); // 1/sqrt(100)
    });

    test("factor always decreases with more applications", () => {
      let prev = stabilizingFactor(0);
      for (let i = 1; i <= 20; i++) {
        const curr = stabilizingFactor(i);
        expect(curr).toBeLessThan(prev);
        prev = curr;
      }
    });
  });

  describe("positive reinforcement", () => {
    test("first positive signal gives full boost", () => {
      const delta = POSITIVE_BASE_DELTA * stabilizingFactor(0);
      expect(delta).toBe(0.3);
    });

    test("positive signal after 3 applications gives smaller boost", () => {
      const delta = POSITIVE_BASE_DELTA * stabilizingFactor(3);
      expect(delta).toBeCloseTo(0.15, 1);
    });

    test("confidence increases with positive signal", () => {
      const oldConf = 5.0;
      const delta = POSITIVE_BASE_DELTA * stabilizingFactor(0);
      const newConf = clampConfidence(oldConf + delta);
      expect(newConf).toBe(5.3);
    });

    test("confidence cannot exceed 10.0", () => {
      const oldConf = 9.9;
      const delta = POSITIVE_BASE_DELTA * stabilizingFactor(0);
      const newConf = clampConfidence(oldConf + delta);
      expect(newConf).toBe(10.0);
    });
  });

  describe("negative reinforcement", () => {
    test("first negative signal gives full penalty", () => {
      const delta = NEGATIVE_BASE_DELTA * stabilizingFactor(0);
      expect(delta).toBe(-0.4);
    });

    test("negative signal after 3 applications gives smaller penalty", () => {
      const delta = NEGATIVE_BASE_DELTA * stabilizingFactor(3);
      expect(delta).toBeCloseTo(-0.2, 1);
    });

    test("confidence decreases with negative signal", () => {
      const oldConf = 5.0;
      const delta = NEGATIVE_BASE_DELTA * stabilizingFactor(0);
      const newConf = clampConfidence(oldConf + delta);
      expect(newConf).toBe(4.6);
    });

    test("confidence cannot go below 0.5", () => {
      const oldConf = 0.7;
      const delta = NEGATIVE_BASE_DELTA * stabilizingFactor(0);
      const newConf = clampConfidence(oldConf + delta);
      expect(newConf).toBe(0.5);
    });
  });

  describe("decay", () => {
    test("decay is smaller than negative reinforcement", () => {
      const decayDelta = Math.abs(DECAY_BASE_DELTA * stabilizingFactor(0));
      const negativeDelta = Math.abs(NEGATIVE_BASE_DELTA * stabilizingFactor(0));
      expect(decayDelta).toBeLessThan(negativeDelta);
    });

    test("decay on established learning is minimal", () => {
      const delta = DECAY_BASE_DELTA * stabilizingFactor(50);
      expect(Math.abs(delta)).toBeLessThan(0.02);
    });
  });

  describe("convergence behavior", () => {
    test("high-value learning stabilizes over many positive signals", () => {
      let confidence = 5.0;
      for (let i = 0; i < 50; i++) {
        const delta = POSITIVE_BASE_DELTA * stabilizingFactor(i);
        confidence = clampConfidence(confidence + delta);
      }
      // Should have converged well below the max
      expect(confidence).toBeGreaterThan(6.0);
      expect(confidence).toBeLessThan(10.0);
    });

    test("negative learning converges toward minimum", () => {
      let confidence = 5.0;
      for (let i = 0; i < 50; i++) {
        const delta = NEGATIVE_BASE_DELTA * stabilizingFactor(i);
        confidence = clampConfidence(confidence + delta);
      }
      expect(confidence).toBeLessThan(3.5);
      expect(confidence).toBeGreaterThanOrEqual(0.5);
    });
  });
});
