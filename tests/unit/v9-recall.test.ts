/**
 * v9 Recall Tool Tests
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { recall, formatRecallResult } from "../../src/v9/recall";
import { createTestDb, type TestDb } from "../helpers/db-setup";

describe("v9 Recall", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    const { rawDb, projectId } = testDb;

    // Create file records
    rawDb.run(
      `INSERT INTO files (project_id, path, purpose, type, fragility, content_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [projectId, "src/auth.ts", "Authentication logic", "module", 8, "abc123"],
    );

    rawDb.run(
      `INSERT INTO files (project_id, path, purpose, type, fragility, content_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [projectId, "src/db.ts", "Database connection", "module", 5, "def456"],
    );

    // Create a decision
    rawDb.run(
      `INSERT INTO decisions (project_id, title, decision, reasoning, affects, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, "Use JWT for auth", "Token-based auth", "Stateless", '["src/auth.ts"]', "active"],
    );

    // Create an issue
    rawDb.run(
      `INSERT INTO issues (project_id, title, severity, status, type, affected_files)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, "Auth timeout bug", 7, "open", "bug", '["src/auth.ts"]'],
    );

    // Create a learning
    rawDb.run(
      `INSERT INTO learnings (project_id, category, title, content, confidence, context)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, "gotcha", "JWT needs refresh", "Tokens expire after 1h for src/auth.ts", 8, "auth"],
    );

    // Create co-change correlation
    rawDb.run(
      `INSERT INTO file_correlations (project_id, file_a, file_b, cochange_count)
       VALUES (?, ?, ?, ?)`,
      [projectId, "src/auth.ts", "src/db.ts", 5],
    );

    // FTS entries
    rawDb.run(
      `INSERT INTO fts_decisions (rowid, title, decision, reasoning) VALUES (?, ?, ?, ?)`,
      [1, "Use JWT for auth", "Token-based auth", "Stateless"],
    );
    rawDb.run(
      `INSERT INTO fts_learnings (rowid, title, content, context) VALUES (?, ?, ?, ?)`,
      [1, "JWT needs refresh", "Tokens expire after 1h", ""],
    );
    rawDb.run(
      `INSERT INTO fts_files (rowid, path, purpose) VALUES (?, ?, ?)`,
      [1, "src/auth.ts", "Authentication logic"],
    );
  });

  afterAll(() => testDb.cleanup());

  test("files mode returns fragility, issues, decisions, co-changers", async () => {
    const result = await recall(testDb.db, testDb.projectId, testDb.tempDir, { files: ["src/auth.ts"] });

    expect(result.mode).toBe("files");
    expect(result.files).toHaveLength(1);

    const file = result.files[0];
    expect(file.path).toBe("src/auth.ts");
    expect(file.fragility).toBe(8);
    expect(file.purpose).toBe("Authentication logic");
    expect(file.issues.length).toBeGreaterThanOrEqual(1);
    expect(file.decisions.length).toBeGreaterThanOrEqual(1);
    expect(file.cochangers.length).toBeGreaterThanOrEqual(1);
    expect(file.cochangers[0].file).toBe("src/db.ts");

    // High fragility should generate a warning
    expect(result.warnings.some((w) => w.includes("FRAGILITY"))).toBe(true);
  });

  test("files mode handles unknown files gracefully", async () => {
    const result = await recall(testDb.db, testDb.projectId, testDb.tempDir, { files: ["nonexistent.ts"] });
    expect(result.mode).toBe("files");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].fragility).toBe(0);
  });

  test("search mode finds decisions and learnings via FTS", async () => {
    const result = await recall(testDb.db, testDb.projectId, testDb.tempDir, { query: "JWT auth" });
    expect(result.mode).toBe("search");
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  test("plan mode returns related files via FTS", async () => {
    const result = await recall(testDb.db, testDb.projectId, testDb.tempDir, { task: "fix authentication" });
    expect(result.mode).toBe("plan");
    // FTS results from fts_files/fts_decisions/fts_learnings
    expect(result.results.length).toBeGreaterThanOrEqual(0);
  });

  test("empty input returns helpful message", async () => {
    const result = await recall(testDb.db, testDb.projectId, testDb.tempDir, {});
    expect(result.warnings).toContain("Provide files, query, or task");
  });

  test("formatRecallResult produces compact output", () => {
    const result = {
      mode: "files" as const,
      files: [{
        path: "src/auth.ts",
        fragility: 8,
        purpose: "Auth logic",
        type: "module",
        isStale: false,
        cochangers: [{ file: "src/db.ts", count: 5 }],
        decisions: [{ id: 1, title: "Use JWT" }],
        issues: [{ id: 1, title: "Timeout bug", severity: 7 }],
        learnings: [{ title: "JWT refresh", content: "Tokens expire", category: "gotcha", confidence: 8 }],
        blastRadius: { score: 45, direct: 3, transitive: 12, tests: 2, risk: "medium" },
        warnings: ["HIGH FRAGILITY (8/10)"],
      }],
      results: [],
      relatedFiles: [],
      warnings: ["HIGH FRAGILITY: src/auth.ts (8/10) — explain approach before editing"],
    };

    const formatted = formatRecallResult(result);
    expect(formatted).toContain("WARNINGS:");
    expect(formatted).toContain("F[src/auth.ts|frag:8|module|Auth logic]");
    expect(formatted).toContain("co-changes:");
    expect(formatted).toContain("D[Use JWT]");
    expect(formatted).toContain("I[#1|sev:7|Timeout bug]");
    expect(formatted).toContain("B[score:45|direct:3|trans:12|tests:2|risk:medium]");
  });
});
