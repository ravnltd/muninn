/**
 * v9 Remember Tool Tests
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { remember, formatRememberResult } from "../../src/v9/remember";
import { createTestDb, type TestDb } from "../helpers/db-setup";

describe("v9 Remember", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => testDb.cleanup());

  test("auto-detects decisions from content", async () => {
    const result = await remember(testDb.db, testDb.projectId, {
      content: "Chose token-bucket over sliding-window for rate limiting because its simpler to implement",
    });

    expect(result.detectedType).toBe("decision");
    expect(result.deduplicated).toBe(false);
    expect(result.id).toBeGreaterThan(0);
  });

  test("auto-detects learnings from content", async () => {
    const result = await remember(testDb.db, testDb.projectId, {
      content: "SQLite WAL mode needs PRAGMA busy_timeout set to avoid lock errors",
    });

    expect(result.detectedType).toBe("learning");
    expect(result.deduplicated).toBe(false);
    expect(result.id).toBeGreaterThan(0);
  });

  test("respects explicit type override", async () => {
    const result = await remember(testDb.db, testDb.projectId, {
      content: "Always validate at API boundaries",
      type: "decision",
    });

    expect(result.detectedType).toBe("decision");
  });

  test("handles files parameter", async () => {
    const result = await remember(testDb.db, testDb.projectId, {
      content: "Database migrations must be append-only, never modify existing",
      files: ["src/database/migrations.ts"],
    });

    expect(result.id).toBeGreaterThan(0);

    // Verify the file was stored in context column
    const record = await testDb.db.get<{ context: string }>(
      `SELECT context FROM learnings WHERE id = ?`,
      [result.id],
    );
    expect(record?.context).toContain("migrations.ts");
  });

  test("deduplicates exact title matches", async () => {
    // First insert
    const first = await remember(testDb.db, testDb.projectId, {
      content: "Use Zod for all input validation across the project",
    });

    // Second insert with same beginning
    const second = await remember(testDb.db, testDb.projectId, {
      content: "Use Zod for all input validation across the project and at every boundary",
    });

    expect(second.deduplicated).toBe(true);
    expect(second.existingId).toBe(first.id);
  });

  test("formatRememberResult produces readable output", () => {
    const formatted = formatRememberResult({
      id: 42,
      detectedType: "decision",
      title: "Use token-bucket for rate limiting",
      deduplicated: false,
    });

    expect(formatted).toContain("Saved as Decision #42");
    expect(formatted).toContain("token-bucket");
  });

  test("formatRememberResult shows deduplication", () => {
    const formatted = formatRememberResult({
      id: 42,
      detectedType: "learning",
      title: "Always close connections",
      deduplicated: true,
      existingId: 42,
    });

    expect(formatted).toContain("Updated");
    expect(formatted).toContain("merged");
  });
});
