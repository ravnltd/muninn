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
      content: "Use Zod for all input validation across the project. Reason one.",
    });

    // Second insert with same beginning
    const second = await remember(testDb.db, testDb.projectId, {
      content: "Use Zod for all input validation across the project. Reason two at every boundary.",
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

describe("v9 Remember data-integrity fixes", () => {
  let t: TestDb;

  beforeAll(() => {
    t = createTestDb();
  });

  afterAll(() => t.cleanup());

  const decisionRow = (id: number) =>
    t.db.get<{ decision: string; status: string; superseded_by: number | null }>(
      "SELECT decision, status, superseded_by FROM decisions WHERE id = ?",
      [id],
    );
  const learningRow = (id: number) =>
    t.db.get<{ content: string; archived_at: string | null }>(
      "SELECT content, archived_at FROM learnings WHERE id = ?",
      [id],
    );

  test("extractTitle keeps up to 120 chars at a word boundary", async () => {
    const content =
      "HARD RULE from the owner (2026-08-30): NEVER put their private keys into any repository or log output ever";
    const r = await remember(t.db, t.projectId, { content, type: "learning" });
    expect(r.title).toBe(content);
  });

  test("new learning supersedes learning only, not same-id decision", async () => {
    const a = createTestDb();
    try {
      await a.db.run("INSERT INTO decisions (project_id, title, decision, status) VALUES (?, 'D', 'dec', 'active')", [a.projectId]);
      await a.db.run("INSERT INTO learnings (project_id, category, title, content) VALUES (?, 'gotcha', 'L', 'old')", [a.projectId]);
      const l2 = await remember(a.db, a.projectId, {
        content: "Entirely different note regarding gears pulleys",
        type: "learning",
        supersedes: 1,
      });
      const l1 = await a.db.get<{ archived_at: string | null; consolidated_into: number | null }>(
        "SELECT archived_at, consolidated_into FROM learnings WHERE id = 1",
      );
      const d = await a.db.get<{ status: string }>("SELECT status FROM decisions WHERE id = 1");
      expect(l1?.archived_at).not.toBeNull();
      expect(l1?.consolidated_into).toBe(l2.id);
      expect(d?.status).toBe("active");
    } finally {
      a.cleanup();
    }
  });

  test("new decision supersedes decision only and links it", async () => {
    const a = createTestDb();
    try {
      await a.db.run(
        "CREATE TABLE IF NOT EXISTS decision_links (decision_id INTEGER, linked_decision_id INTEGER, link_type TEXT, strength REAL)",
      );
      await a.db.run("INSERT INTO decisions (project_id, title, decision, status) VALUES (?, 'D', 'dec', 'active')", [a.projectId]);
      await a.db.run("INSERT INTO learnings (project_id, category, title, content) VALUES (?, 'gotcha', 'L', 'lrn')", [a.projectId]);
      const d2 = await remember(a.db, a.projectId, {
        content: "Chose nats over redis because clustering",
        type: "decision",
        supersedes: 1,
      });
      const d1 = await a.db.get<{ status: string; superseded_by: number | null }>(
        "SELECT status, superseded_by FROM decisions WHERE id = 1",
      );
      const l = await a.db.get<{ archived_at: string | null }>("SELECT archived_at FROM learnings WHERE id = 1");
      const link = await a.db.get<{ linked_decision_id: number }>(
        "SELECT linked_decision_id FROM decision_links WHERE decision_id = ?",
        [d2.id],
      );
      expect(d1?.status).toBe("superseded");
      expect(d1?.superseded_by).toBe(d2.id);
      expect(l?.archived_at).toBeNull();
      expect(link?.linked_decision_id).toBe(1);
    } finally {
      a.cleanup();
    }
  });

  test("bad supersedes throws before inserting", async () => {
    const before = await t.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM decisions");
    await expect(
      remember(t.db, t.projectId, { content: "Chose x over y because z", type: "decision", supersedes: 99999 }),
    ).rejects.toThrow("Decision #99999 not found in this project");
    const after = await t.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM decisions");
    expect(after?.n).toBe(before?.n);
  });

  test("amend by id with ambiguous id requires type", async () => {
    const a = createTestDb();
    try {
      await a.db.run("INSERT INTO decisions (project_id, title, decision, status) VALUES (?, 'D', 'orig decision', 'active')", [a.projectId]);
      await a.db.run("INSERT INTO learnings (project_id, category, title, content) VALUES (?, 'gotcha', 'L', 'orig learning')", [a.projectId]);
      await expect(remember(a.db, a.projectId, { content: "amended", id: 1 })).rejects.toThrow('type: "decision"');

      await remember(a.db, a.projectId, { content: "amended learning text", id: 1, type: "learning" });
      const l = await a.db.get<{ content: string }>("SELECT content FROM learnings WHERE id = 1");
      const d = await a.db.get<{ decision: string }>("SELECT decision FROM decisions WHERE id = 1");
      expect(l?.content).toBe("amended learning text");
      expect(d?.decision).toBe("orig decision");
    } finally {
      a.cleanup();
    }
  });

  test("amend by id with unique id works without type", async () => {
    const a = createTestDb();
    try {
      await a.db.run("INSERT INTO learnings (project_id, category, title, content) VALUES (?, 'gotcha', 'L', 'orig')", [a.projectId]);
      const r = await remember(a.db, a.projectId, { content: "amended body", id: 1 });
      expect(r.detectedType).toBe("learning");
      const l = await a.db.get<{ content: string }>("SELECT content FROM learnings WHERE id = 1");
      expect(l?.content).toBe("amended body");
    } finally {
      a.cleanup();
    }
  });

  test("duplicate title appends instead of overwriting, no-op when identical", async () => {
    const first = await remember(t.db, t.projectId, { content: "Retry policy for webhook delivery needs jitter.", type: "learning" });
    const dup = await remember(t.db, t.projectId, {
      content: "Retry policy for webhook delivery needs jitter. Cap at 5 attempts.",
      type: "learning",
    });
    expect(dup.deduplicated).toBe(true);
    expect(dup.id).toBe(first.id);
    const row = await learningRow(first.id);
    expect(row?.content).toContain("Retry policy for webhook delivery needs jitter.");
    expect(row?.content).toContain("\n\n---\n[updated ");
    expect(row?.content).toContain("Cap at 5 attempts.");

    const fts = await t.db.get<{ rowid: number }>(
      "SELECT rowid FROM fts_learnings WHERE fts_learnings MATCH ?",
      ['"attempts"'],
    );
    expect(fts?.rowid).toBe(first.id);

    const before = row?.content;
    const same = await remember(t.db, t.projectId, { content: "Retry policy for webhook delivery needs jitter.", type: "learning" });
    expect(same.deduplicated).toBe(true);
    expect(same.id).toBe(first.id);
    expect((await learningRow(first.id))?.content).toBe(before);
  });

  test("supersedes with an identical title creates a new version instead of merging", async () => {
    const old = await remember(t.db, t.projectId, { content: "Deploy window is Tuesdays only.", type: "learning" });
    const next = await remember(t.db, t.projectId, {
      content: "Deploy window is Tuesdays only.",
      type: "learning",
      supersedes: old.id,
    });
    expect(next.deduplicated).toBe(false);
    expect(next.id).not.toBe(old.id);
    expect((await learningRow(old.id))?.archived_at).not.toBeNull();
  });
});
