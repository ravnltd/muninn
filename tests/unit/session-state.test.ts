/**
 * SessionState tests — hook communication layer
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SessionState } from "../../src/session-state";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const TEST_PROJECT = "/tmp/muninn-test-project-" + Date.now();

function cleanup(state: SessionState): void {
  const paths = state.getPaths();
  for (const p of Object.values(paths)) {
    try { unlinkSync(p); } catch {}
    try { unlinkSync(p + ".tmp"); } catch {}
  }
}

describe("SessionState", () => {
  let state: SessionState;

  beforeEach(() => {
    state = new SessionState(TEST_PROJECT);
    cleanup(state);
  });

  afterEach(() => {
    cleanup(state);
  });

  describe("markChecked + isChecked", () => {
    test("records and retrieves checked files", () => {
      state.markChecked(["src/foo.ts", "src/bar.ts"]);

      expect(state.isChecked("src/foo.ts")).toBe(true);
      expect(state.isChecked("src/bar.ts")).toBe(true);
      expect(state.isChecked("src/baz.ts")).toBe(false);
    });

    test("appends to existing checked files", () => {
      state.markChecked(["src/foo.ts"]);
      state.markChecked(["src/bar.ts"]);

      expect(state.isChecked("src/foo.ts")).toBe(true);
      expect(state.isChecked("src/bar.ts")).toBe(true);
    });

    test("returns false when no checked file exists", () => {
      expect(state.isChecked("src/foo.ts")).toBe(false);
    });
  });

  describe("writeContext", () => {
    test("writes context atomically", () => {
      const context = "Fragile files in scope:\n  F[src/mcp-server.ts|frag:7]";
      state.writeContext(context);

      const paths = state.getPaths();
      expect(existsSync(paths.contextPath)).toBe(true);

      const content = readFileSync(paths.contextPath, "utf-8");
      expect(content).toBe(context);
    });

    test("overwrites previous context", () => {
      state.writeContext("old context");
      state.writeContext("new context");

      const paths = state.getPaths();
      const content = readFileSync(paths.contextPath, "utf-8");
      expect(content).toBe("new context");
    });

    test("leaves no .tmp file after write", () => {
      state.writeContext("test");

      const paths = state.getPaths();
      expect(existsSync(paths.contextPath + ".tmp")).toBe(false);
    });
  });

  describe("clear", () => {
    test("clears checked files", () => {
      state.markChecked(["src/foo.ts"]);
      state.clear();

      expect(state.isChecked("src/foo.ts")).toBe(false);
    });

    test("removes context file", () => {
      state.writeContext("some context");
      state.clear();

      const paths = state.getPaths();
      expect(existsSync(paths.contextPath)).toBe(false);
    });

    test("works when no state exists", () => {
      // Should not throw
      state.clear();
    });
  });

  describe("writeDiscoveryFile", () => {
    test("writes JSON with correct paths", () => {
      state.writeDiscoveryFile();

      const paths = state.getPaths();
      expect(existsSync(paths.discoveryPath)).toBe(true);

      const content = JSON.parse(readFileSync(paths.discoveryPath, "utf-8"));
      expect(content.checkedPath).toBe(paths.checkedPath);
      expect(content.contextPath).toBe(paths.contextPath);
    });
  });

  describe("trimIfNeeded", () => {
    test("trims when exceeding 200 entries", () => {
      // Write 210 entries directly to the checked file
      const paths = state.getPaths();
      const lines = Array.from({ length: 210 }, (_, i) => `file-${i}.ts`);
      writeFileSync(paths.checkedPath, lines.join("\n") + "\n");

      // Trigger trim by adding one more
      state.markChecked(["trigger.ts"]);

      const content = readFileSync(paths.checkedPath, "utf-8");
      const resultLines = content.split("\n").filter(Boolean);

      // Should be trimmed to ~100 + 1 new entry
      expect(resultLines.length).toBeLessThanOrEqual(102);
      // Should keep the most recent entries
      expect(resultLines).toContain("trigger.ts");
      expect(resultLines).toContain("file-209.ts");
    });

    test("does not trim under 200 entries", () => {
      const files = Array.from({ length: 50 }, (_, i) => `file-${i}.ts`);
      state.markChecked(files);

      const paths = state.getPaths();
      const content = readFileSync(paths.checkedPath, "utf-8");
      const resultLines = content.split("\n").filter(Boolean);
      expect(resultLines.length).toBe(50);
    });
  });

  describe("project isolation", () => {
    test("different projects get different paths", () => {
      const state1 = new SessionState("/project/alpha");
      const state2 = new SessionState("/project/beta");

      const paths1 = state1.getPaths();
      const paths2 = state2.getPaths();

      expect(paths1.checkedPath).not.toBe(paths2.checkedPath);
      expect(paths1.contextPath).not.toBe(paths2.contextPath);
      expect(paths1.discoveryPath).not.toBe(paths2.discoveryPath);
    });

    test("same project path gets same paths", () => {
      const state1 = new SessionState("/project/same");
      const state2 = new SessionState("/project/same");

      expect(state1.getPaths()).toEqual(state2.getPaths());
    });
  });
});
