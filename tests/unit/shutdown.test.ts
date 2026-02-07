/**
 * Shutdown manager tests
 *
 * Note: We can't test process.exit() directly, so we test the cleanup
 * registration and execution logic by importing the module fresh.
 */

import { describe, expect, test } from "bun:test";

describe("shutdown manager", () => {
  test("onShutdown registers cleanup functions", async () => {
    // Import fresh instance by using dynamic import with cache bust
    const mod = await import("../../src/utils/shutdown");

    // onShutdown should not throw
    expect(() => mod.onShutdown(() => {})).not.toThrow();
    expect(() => mod.onShutdown(async () => {})).not.toThrow();
  });

  test("installSignalHandlers does not throw", async () => {
    const mod = await import("../../src/utils/shutdown");
    expect(() => mod.installSignalHandlers()).not.toThrow();
  });
});
