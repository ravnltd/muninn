/**
 * Tests for task analyzer: keyword extraction, task type detection, domain extraction
 */

import { describe, expect, test } from "bun:test";
import {
  extractKeywords,
  extractFiles,
  detectTaskType,
  extractDomains,
} from "../../src/context/task-analyzer";

describe("extractKeywords", () => {
  test("extracts from query field", () => {
    const keywords = extractKeywords("muninn_query", { query: "fix authentication bug" });
    expect(keywords).toContain("fix");
    expect(keywords).toContain("authentication");
    expect(keywords).toContain("bug");
  });

  test("extracts from task field", () => {
    const keywords = extractKeywords("muninn_suggest", { task: "implement dark mode" });
    expect(keywords).toContain("implement");
    expect(keywords).toContain("dark");
    expect(keywords).toContain("mode");
  });

  test("extracts from file paths", () => {
    const keywords = extractKeywords("muninn_check", {
      files: ["src/auth/session-manager.ts"],
    });
    expect(keywords).toContain("auth");
    expect(keywords).toContain("session");
    expect(keywords).toContain("manager");
  });

  test("filters stop words", () => {
    const keywords = extractKeywords("muninn_query", { query: "the bug is in the code" });
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("is");
    expect(keywords).toContain("bug");
    expect(keywords).toContain("code");
  });

  test("filters short words", () => {
    const keywords = extractKeywords("muninn_query", { query: "a db fix" });
    expect(keywords).not.toContain("a");
    expect(keywords).not.toContain("db");
    expect(keywords).toContain("fix");
  });

  test("adds tool-specific hints", () => {
    const keywords = extractKeywords("muninn_check", { files: ["src/test.ts"] });
    expect(keywords).toContain("edit");
  });

  test("handles empty args", () => {
    const keywords = extractKeywords("muninn_query", {});
    expect(keywords).toEqual([]);
  });
});

describe("extractFiles", () => {
  test("extracts from path field", () => {
    const files = extractFiles({ path: "src/index.ts" });
    expect(files).toEqual(["src/index.ts"]);
  });

  test("extracts from files array", () => {
    const files = extractFiles({ files: ["a.ts", "b.ts"] });
    expect(files).toEqual(["a.ts", "b.ts"]);
  });

  test("extracts from enrich input JSON", () => {
    const files = extractFiles({
      input: JSON.stringify({ file_path: "src/utils.ts" }),
    });
    expect(files).toContain("src/utils.ts");
  });

  test("handles invalid JSON in input", () => {
    const files = extractFiles({ input: "not json" });
    expect(files).toEqual([]);
  });

  test("handles empty args", () => {
    const files = extractFiles({});
    expect(files).toEqual([]);
  });
});

describe("detectTaskType", () => {
  test("detects bugfix from keywords", () => {
    expect(detectTaskType(["fix", "bug", "error"])).toBe("bugfix");
  });

  test("detects feature from keywords", () => {
    expect(detectTaskType(["add", "implement", "new"])).toBe("feature");
  });

  test("detects refactor from keywords", () => {
    expect(detectTaskType(["refactor", "clean", "extract"])).toBe("refactor");
  });

  test("detects testing from keywords", () => {
    expect(detectTaskType(["test", "coverage", "unit"])).toBe("testing");
  });

  test("detects documentation from keywords", () => {
    expect(detectTaskType(["doc", "readme", "comment"])).toBe("documentation");
  });

  test("detects performance from keywords", () => {
    expect(detectTaskType(["optimize", "perf", "cache"])).toBe("performance");
  });

  test("detects configuration from keywords", () => {
    expect(detectTaskType(["config", "setup", "docker"])).toBe("configuration");
  });

  test("detects exploration from keywords", () => {
    expect(detectTaskType(["find", "search", "explore"])).toBe("exploration");
  });

  test("returns unknown for unrecognized keywords", () => {
    expect(detectTaskType(["xyz", "abc", "zzz"])).toBe("unknown");
  });

  test("handles empty keywords", () => {
    expect(detectTaskType([])).toBe("unknown");
  });

  test("picks highest-scoring type when ambiguous", () => {
    // 2 bug keywords vs 1 feature keyword
    const result = detectTaskType(["fix", "bug", "add"]);
    expect(result).toBe("bugfix");
  });
});

describe("extractDomains", () => {
  test("extracts domain directories from file paths", () => {
    const domains = extractDomains(["src/auth/login.ts", "src/auth/session.ts"]);
    expect(domains).toContain("auth");
  });

  test("skips common non-meaningful directories", () => {
    const domains = extractDomains(["src/lib/auth/index.ts"]);
    expect(domains).not.toContain("src");
    expect(domains).not.toContain("lib");
    expect(domains).toContain("auth");
  });

  test("skips file names (entries with dots)", () => {
    const domains = extractDomains(["src/utils/format.ts"]);
    expect(domains).not.toContain("format.ts");
  });

  test("limits to 5 domains", () => {
    const paths = Array.from({ length: 20 }, (_, i) => `src/domain${i}/index.ts`);
    const domains = extractDomains(paths);
    expect(domains.length).toBeLessThanOrEqual(5);
  });

  test("handles empty files array", () => {
    const domains = extractDomains([]);
    expect(domains).toEqual([]);
  });
});
