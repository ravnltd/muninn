/**
 * Tests for neuro-aware memory scoring — the cognitive retrieval engine.
 */
import { describe, expect, test } from "bun:test";
import {
  emotionalIntensity,
  parseNeuroState,
  recencyScore,
  scoreWithNeuro,
  stateSimilarity,
  type NeuroState,
} from "../../src/intelligence/neuro-scoring";

const calm: NeuroState = {
  dopamine: 0.3,
  serotonin: 0.6,
  norepinephrine: 0.2,
  acetylcholine: 0.3,
};

const alert: NeuroState = {
  dopamine: 0.7,
  serotonin: 0.3,
  norepinephrine: 0.8,
  acetylcholine: 0.5,
};

const learning: NeuroState = {
  dopamine: 0.4,
  serotonin: 0.5,
  norepinephrine: 0.3,
  acetylcholine: 0.9,
};

describe("Neuro Scoring", () => {
  describe("recencyScore", () => {
    test("returns 1.0 for age 0", () => {
      expect(recencyScore(0)).toBe(1.0);
    });

    test("returns ~0.5 at half-life (24h)", () => {
      const score = recencyScore(24);
      expect(score).toBeGreaterThan(0.49);
      expect(score).toBeLessThan(0.51);
    });

    test("decays toward 0 for very old memories", () => {
      expect(recencyScore(168)).toBeLessThan(0.01); // 7 days
    });

    test("negative age returns 1.0", () => {
      expect(recencyScore(-5)).toBe(1.0);
    });
  });

  describe("emotionalIntensity", () => {
    test("calm state gives baseline intensity", () => {
      const intensity = emotionalIntensity(calm);
      expect(intensity).toBeGreaterThanOrEqual(0.3);
      expect(intensity).toBeLessThan(0.6);
    });

    test("alert state gives high intensity", () => {
      const intensity = emotionalIntensity(alert);
      expect(intensity).toBeGreaterThan(0.7);
    });

    test("intensity range is 0.3 to 1.0", () => {
      const zero: NeuroState = { dopamine: 0, serotonin: 0, norepinephrine: 0, acetylcholine: 0 };
      const max: NeuroState = { dopamine: 1, serotonin: 1, norepinephrine: 1, acetylcholine: 1 };
      expect(emotionalIntensity(zero)).toBe(0.3);
      expect(emotionalIntensity(max)).toBe(1.0);
    });
  });

  describe("stateSimilarity", () => {
    test("identical states have similarity 1.0", () => {
      expect(stateSimilarity(calm, calm)).toBeCloseTo(1.0, 2);
    });

    test("different states have lower similarity", () => {
      const sim = stateSimilarity(calm, alert);
      expect(sim).toBeLessThan(1.0);
      expect(sim).toBeGreaterThanOrEqual(0.5); // floor
    });

    test("similarity is symmetric", () => {
      const ab = stateSimilarity(calm, alert);
      const ba = stateSimilarity(alert, calm);
      expect(ab).toBeCloseTo(ba, 5);
    });

    test("similarity range is 0.5 to 1.0", () => {
      const opposite: NeuroState = { dopamine: 0, serotonin: 1, norepinephrine: 0, acetylcholine: 1 };
      const sim = stateSimilarity(alert, opposite);
      expect(sim).toBeGreaterThanOrEqual(0.5);
      expect(sim).toBeLessThanOrEqual(1.0);
    });
  });

  describe("scoreWithNeuro", () => {
    test("recent memory with matching state scores reasonably", () => {
      const score = scoreWithNeuro(1, calm, calm);
      // Calm state has low intensity (~0.51), so score is ~0.49
      expect(score).toBeGreaterThan(0.3);
    });

    test("old memory with mismatched state scores low", () => {
      const score = scoreWithNeuro(72, calm, alert);
      expect(score).toBeLessThan(0.2);
    });

    test("null neuro states fall back to recency only", () => {
      const score = scoreWithNeuro(12, null, null);
      const recency = recencyScore(12);
      expect(score).toBeCloseTo(recency, 5);
    });

    test("null stored neuro falls back to recency", () => {
      const score = scoreWithNeuro(6, null, calm);
      expect(score).toBeCloseTo(recencyScore(6), 5);
    });

    test("score never exceeds 1.0", () => {
      const score = scoreWithNeuro(0, alert, alert);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    test("alert memories rank higher during alert state", () => {
      const alertMemDuringAlert = scoreWithNeuro(2, alert, alert);
      const calmMemDuringAlert = scoreWithNeuro(2, calm, alert);
      expect(alertMemDuringAlert).toBeGreaterThan(calmMemDuringAlert);
    });

    test("state similarity boosts matching memories at same intensity", () => {
      // To isolate state-dependence, compare same-intensity memories
      // with different similarity to current state
      const matchingState = scoreWithNeuro(2, calm, calm);
      const mismatchedState = scoreWithNeuro(2, calm, alert);
      // Matching state should score higher (similarity boost)
      expect(matchingState).toBeGreaterThan(mismatchedState);
    });
  });

  describe("parseNeuroState", () => {
    test("parses valid JSON", () => {
      const state = parseNeuroState(
        '{"dopamine":0.5,"serotonin":0.6,"norepinephrine":0.3,"acetylcholine":0.4}',
      );
      expect(state).not.toBeNull();
      expect(state!.dopamine).toBe(0.5);
    });

    test("returns null for empty string", () => {
      expect(parseNeuroState("")).toBeNull();
    });

    test("returns null for null", () => {
      expect(parseNeuroState(null)).toBeNull();
    });

    test("returns null for invalid JSON", () => {
      expect(parseNeuroState("{broken")).toBeNull();
    });

    test("returns null for incomplete state", () => {
      expect(parseNeuroState('{"dopamine":0.5}')).toBeNull();
    });

    test("returns null for non-numeric values", () => {
      expect(
        parseNeuroState('{"dopamine":"high","serotonin":"low","norepinephrine":"mid","acetylcholine":"ok"}'),
      ).toBeNull();
    });
  });
});
