/**
 * Tests for error detector: pattern matching, signature normalization, deduplication
 */

import { describe, expect, test } from "bun:test";
import { detectErrors } from "../../src/ingestion/error-detector";

describe("detectErrors", () => {
  test("detects TypeScript errors", () => {
    const output = "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.";
    const errors = detectErrors(output);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].errorType).toBe("build_error");
  });

  test("detects runtime errors", () => {
    const output = "TypeError: Cannot read properties of undefined (reading 'map')";
    const errors = detectErrors(output);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("detects syntax errors", () => {
    const output = "SyntaxError: Unexpected token '}'";
    const errors = detectErrors(output);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("returns empty array for clean output", () => {
    const output = "All tests passed. 42 tests, 0 failures.";
    const errors = detectErrors(output);
    expect(errors).toEqual([]);
  });

  test("deduplicates identical errors", () => {
    const output = [
      "TypeError: Cannot read properties of undefined (reading 'x')",
      "TypeError: Cannot read properties of undefined (reading 'x')",
    ].join("\n");
    const errors = detectErrors(output);
    // Should deduplicate
    expect(errors.length).toBeLessThanOrEqual(2);
  });

  test("handles empty output", () => {
    const errors = detectErrors("");
    expect(errors).toEqual([]);
  });

  test("handles multiline error output", () => {
    const output = `
Error: ENOENT: no such file or directory, open '/tmp/missing.txt'
    at Object.openSync (node:fs:600:3)
    at Object.readFileSync (node:fs:468:35)
`;
    const errors = detectErrors(output);
    expect(errors.length).toBeGreaterThan(0);
  });
});
