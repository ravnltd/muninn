/**
 * v9 Track Tool Tests
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { track, formatTrackResult } from "../../src/v9/track";
import { createTestDb, type TestDb } from "../helpers/db-setup";

describe("v9 Track", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => testDb.cleanup());

  test("adds an issue", async () => {
    const result = await track(testDb.db, testDb.projectId, {
      action: "add",
      title: "Auth timeout on slow connections",
      description: "Users get logged out after 30s",
      severity: 7,
      type: "bug",
    });

    expect(result.action).toBe("added");
    expect(result.id).toBeGreaterThan(0);
    expect(result.title).toBe("Auth timeout on slow connections");

    // Verify in DB
    const issue = await testDb.db.get<{ title: string; severity: number; status: string }>(
      "SELECT title, severity, status FROM issues WHERE id = ?",
      [result.id],
    );
    expect(issue?.title).toBe("Auth timeout on slow connections");
    expect(issue?.severity).toBe(7);
    expect(issue?.status).toBe("open");
  });

  test("adds issue with defaults", async () => {
    const result = await track(testDb.db, testDb.projectId, {
      action: "add",
      title: "Minor styling issue",
    });

    const issue = await testDb.db.get<{ severity: number; type: string }>(
      "SELECT severity, type FROM issues WHERE id = ?",
      [result.id],
    );
    expect(issue?.severity).toBe(5);
    expect(issue?.type).toBe("bug");
  });

  test("resolves an issue", async () => {
    const added = await track(testDb.db, testDb.projectId, {
      action: "add",
      title: "Fix me",
    });

    const resolved = await track(testDb.db, testDb.projectId, {
      action: "resolve",
      id: added.id,
      resolution: "Fixed by increasing timeout",
    });

    expect(resolved.action).toBe("resolved");
    expect(resolved.id).toBe(added.id);

    const issue = await testDb.db.get<{ status: string; resolution: string }>(
      "SELECT status, resolution FROM issues WHERE id = ?",
      [added.id],
    );
    expect(issue?.status).toBe("resolved");
    expect(issue?.resolution).toBe("Fixed by increasing timeout");
  });

  test("throws for nonexistent issue", async () => {
    expect(
      track(testDb.db, testDb.projectId, { action: "resolve", id: 99999, resolution: "Fixed" }),
    ).rejects.toThrow("not found");
  });

  test("formatTrackResult for add", () => {
    expect(formatTrackResult({ action: "added", id: 5, title: "Bug X" }))
      .toBe("Issue #5 tracked: Bug X");
  });

  test("formatTrackResult for resolve", () => {
    expect(formatTrackResult({ action: "resolved", id: 5, title: "Bug X" }))
      .toBe("Issue #5 resolved: Bug X");
  });
});
