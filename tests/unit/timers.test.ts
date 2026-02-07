/**
 * Safe timer utilities tests
 */

import { describe, expect, test } from "bun:test";
import { safeTimeout, safeInterval } from "../../src/utils/timers";

describe("safeTimeout", () => {
  test("executes callback", async () => {
    let called = false;
    safeTimeout(() => { called = true; }, 0);
    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(true);
  });

  test("returns a timer that can be cleared", () => {
    let called = false;
    const timer = safeTimeout(() => { called = true; }, 1000);
    clearTimeout(timer);
    expect(called).toBe(false);
  });
});

describe("safeInterval", () => {
  test("executes callback repeatedly", async () => {
    let count = 0;
    const timer = safeInterval(() => { count++; }, 5);
    await new Promise((r) => setTimeout(r, 30));
    clearInterval(timer);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("returns a timer that can be cleared", async () => {
    let count = 0;
    const timer = safeInterval(() => { count++; }, 5);
    clearInterval(timer);
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(0);
  });
});
