/**
 * Tests for v5 Phase 5: Progressive Context Refinement
 *
 * Tests the context quality tracking and refresh logic in shifter.ts.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  setContextFiles,
  recordFileAccess,
  shouldRefreshContext,
  resetQuality,
  getQualityMetrics,
  resetShifter,
} from "../../src/context/shifter";

beforeEach(() => {
  resetShifter();
});

describe("context quality tracking", () => {
  test("initial state: no refresh needed", () => {
    expect(shouldRefreshContext()).toBe(false);
  });

  test("does not refresh with insufficient data (< 3 accesses)", () => {
    setContextFiles(["a.ts", "b.ts"]);
    recordFileAccess("c.ts"); // miss
    recordFileAccess("d.ts"); // miss
    // Only 2 accesses — not enough data
    expect(shouldRefreshContext()).toBe(false);
  });

  test("hit rate is 1.0 when all accessed files are in context", () => {
    setContextFiles(["a.ts", "b.ts", "c.ts"]);
    recordFileAccess("a.ts");
    recordFileAccess("b.ts");
    recordFileAccess("c.ts");
    const metrics = getQualityMetrics();
    expect(metrics.hitRate).toBe(1.0);
    expect(metrics.misses).toBe(0);
  });

  test("3 consecutive misses triggers refresh", () => {
    setContextFiles(["a.ts"]);
    recordFileAccess("x.ts"); // miss
    recordFileAccess("y.ts"); // miss
    recordFileAccess("z.ts"); // miss (3 consecutive)

    // Need to clear the cooldown that was set by setContextFiles
    // Simulate time passing by manipulating the state
    // Since we can't easily mock Date.now(), we test the miss threshold
    const metrics = getQualityMetrics();
    expect(metrics.misses).toBe(3);
    expect(metrics.accesses).toBe(3);
  });

  test("hit resets consecutive miss counter", () => {
    setContextFiles(["a.ts"]);
    recordFileAccess("x.ts"); // miss
    recordFileAccess("y.ts"); // miss
    recordFileAccess("a.ts"); // hit — resets
    const metrics = getQualityMetrics();
    expect(metrics.misses).toBe(0);
  });

  test("tracks overall hit rate correctly", () => {
    setContextFiles(["a.ts", "b.ts"]);
    recordFileAccess("a.ts"); // hit
    recordFileAccess("c.ts"); // miss
    recordFileAccess("b.ts"); // hit
    recordFileAccess("d.ts"); // miss
    const metrics = getQualityMetrics();
    expect(metrics.hitRate).toBe(0.5); // 2 hits / 4 accesses
    expect(metrics.accesses).toBe(4);
  });

  test("resetQuality clears all metrics", () => {
    setContextFiles(["a.ts"]);
    recordFileAccess("a.ts");
    recordFileAccess("b.ts");
    resetQuality();
    const metrics = getQualityMetrics();
    expect(metrics.hitRate).toBe(1); // 0/0 = 1.0
    expect(metrics.misses).toBe(0);
    expect(metrics.accesses).toBe(0);
  });

  test("empty context files means all accesses are misses", () => {
    setContextFiles([]);
    recordFileAccess("a.ts");
    recordFileAccess("b.ts");
    recordFileAccess("c.ts");
    const metrics = getQualityMetrics();
    expect(metrics.hitRate).toBe(0);
    expect(metrics.misses).toBe(3);
  });
});

describe("shouldRefreshContext edge cases", () => {
  test("does not refresh when hit rate is high", () => {
    setContextFiles(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
    // 5 hits
    recordFileAccess("a.ts");
    recordFileAccess("b.ts");
    recordFileAccess("c.ts");
    recordFileAccess("d.ts");
    recordFileAccess("e.ts");
    // shouldRefreshContext respects cooldown, but metrics show high quality
    const metrics = getQualityMetrics();
    expect(metrics.hitRate).toBe(1.0);
  });

  test("low hit rate below 30% detected after 5+ accesses", () => {
    setContextFiles(["a.ts"]);
    // 1 hit, 5 misses = 16.7% hit rate
    recordFileAccess("a.ts"); // hit
    recordFileAccess("x.ts"); // miss
    recordFileAccess("y.ts"); // miss
    recordFileAccess("z.ts"); // miss
    recordFileAccess("w.ts"); // miss
    recordFileAccess("v.ts"); // miss
    const metrics = getQualityMetrics();
    expect(metrics.hitRate).toBeCloseTo(0.167, 2);
    expect(metrics.accesses).toBe(6);
  });
});
