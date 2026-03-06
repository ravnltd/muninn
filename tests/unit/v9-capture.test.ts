/**
 * v9 Auto-Capture Tests
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { capture, captureBatch, formatCaptureResult } from "../../src/v9/capture";
import { createTestDb, type TestDb } from "../helpers/db-setup";

describe("v9 Capture", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Create an active session for co-change tracking
    testDb.rawDb.run(
      `INSERT INTO sessions (project_id, goal, files_touched, started_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [testDb.projectId, "Test session", '["src/existing.ts"]'],
    );
  });

  afterAll(() => testDb.cleanup());

  test("creates new file record for unknown file", async () => {
    const result = await capture(
      testDb.db,
      testDb.projectId,
      "src/components/Button.tsx",
      "export const Button = () => <button>Click</button>;",
    );

    expect(result.action).toBe("created");
    expect(result.file).toBe("src/components/Button.tsx");

    // Verify DB record
    const record = await testDb.db.get<{ type: string; purpose: string; fragility: number }>(
      `SELECT type, purpose, fragility FROM files WHERE project_id = ? AND path = ?`,
      [testDb.projectId, "src/components/Button.tsx"],
    );
    expect(record?.type).toBe("component");
    expect(record?.fragility).toBe(1);
    expect(record?.purpose).toContain("Button");
  });

  test("infers file type from path", async () => {
    await capture(testDb.db, testDb.projectId, "src/utils/format.ts");
    const util = await testDb.db.get<{ type: string }>(
      `SELECT type FROM files WHERE project_id = ? AND path = ?`,
      [testDb.projectId, "src/utils/format.ts"],
    );
    expect(util?.type).toBe("util");

    await capture(testDb.db, testDb.projectId, "src/auth.test.ts");
    const testFile = await testDb.db.get<{ type: string }>(
      `SELECT type FROM files WHERE project_id = ? AND path = ?`,
      [testDb.projectId, "src/auth.test.ts"],
    );
    expect(testFile?.type).toBe("test");

    await capture(testDb.db, testDb.projectId, "src/api/routes.ts");
    const api = await testDb.db.get<{ type: string }>(
      `SELECT type FROM files WHERE project_id = ? AND path = ?`,
      [testDb.projectId, "src/api/routes.ts"],
    );
    expect(api?.type).toBe("api");
  });

  test("updates content hash when file changes", async () => {
    // Create file first
    await capture(testDb.db, testDb.projectId, "src/changing.ts", "version 1");

    // Edit it
    const result = await capture(testDb.db, testDb.projectId, "src/changing.ts", "version 2");
    expect(result.action).toBe("updated");

    // Same content should just track
    const same = await capture(testDb.db, testDb.projectId, "src/changing.ts", "version 2");
    expect(same.action).toBe("tracked");
  });

  test("tracks co-changes within session", async () => {
    // The session already has "src/existing.ts" in files_touched
    const result = await capture(testDb.db, testDb.projectId, "src/new-file.ts", "content");

    // Should have created a co-change correlation with src/existing.ts
    expect(result.cochangesUpdated).toBeGreaterThanOrEqual(1);

    const correlation = await testDb.db.get<{ cochange_count: number }>(
      `SELECT cochange_count FROM file_correlations
       WHERE project_id = ? AND
       ((file_a = ? AND file_b = ?) OR (file_a = ? AND file_b = ?))`,
      [testDb.projectId, "src/existing.ts", "src/new-file.ts", "src/new-file.ts", "src/existing.ts"],
    );
    expect(correlation).toBeTruthy();
    expect(correlation!.cochange_count).toBeGreaterThanOrEqual(1);
  });

  test("updates session files_touched", async () => {
    await capture(testDb.db, testDb.projectId, "src/session-tracked.ts");

    const session = await testDb.db.get<{ files_touched: string }>(
      `SELECT files_touched FROM sessions
       WHERE project_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [testDb.projectId],
    );
    const touched = JSON.parse(session?.files_touched || "[]");
    expect(touched).toContain("src/session-tracked.ts");
  });

  test("captureBatch processes multiple files", async () => {
    const results = await captureBatch(testDb.db, testDb.projectId, [
      { path: "src/batch1.ts", content: "one" },
      { path: "src/batch2.ts", content: "two" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].action).toBe("created");
    expect(results[1].action).toBe("created");
  });

  test("formatCaptureResult output", () => {
    expect(formatCaptureResult({ file: "src/a.ts", action: "created", cochangesUpdated: 0 }))
      .toBe("+ src/a.ts");

    expect(formatCaptureResult({ file: "src/b.ts", action: "updated", cochangesUpdated: 2 }))
      .toBe("~ src/b.ts (2 co-changes)");

    expect(formatCaptureResult({ file: "src/c.ts", action: "tracked", cochangesUpdated: 0 }))
      .toBe(". src/c.ts");
  });
});
