/**
 * v10 Context Cache tests — precomputed push-delivery bundles.
 *
 * Covers: refresh writes orientation + per-file bundles, conditional silence
 * for boring files, full-fidelity decision text, single-file refresh, and
 * legacy sidecar layout cleanup.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/db-setup";
import { refreshContextCache, refreshFileBundle } from "../../src/v9/context-cache";

const FRAGILE_FILE = "src/core/engine.ts";
const BORING_FILE = "src/utils/strings.ts";
const DECISION_TEXT =
  "Chose a token-bucket rate limiter over sliding-window because it is simpler to reason about and battle-tested.";
const DECISION_WHY = "Sliding-window needs per-key sorted sets and has worse memory behavior under burst load.";

let testDb: TestDb;

function seed(db: TestDb): void {
  const { rawDb, projectId, tempDir } = db;

  rawDb.exec(`CREATE TABLE IF NOT EXISTS blast_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    total_affected INTEGER DEFAULT 0,
    affected_tests INTEGER DEFAULT 0,
    blast_score REAL DEFAULT 0
  )`);

  // Source files must exist on disk for bundles to be written
  for (const f of [FRAGILE_FILE, BORING_FILE]) {
    mkdirSync(join(tempDir, f, ".."), { recursive: true });
    writeFileSync(join(tempDir, f), "export const x = 1;\n");
  }

  rawDb
    .query(
      `INSERT INTO files (project_id, path, fragility, fragility_reason, purpose, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
    )
    .run(projectId, FRAGILE_FILE, 9, "Core engine, everything depends on it.", "Rate limiting engine");
  rawDb
    .query(`INSERT INTO files (project_id, path, fragility, status) VALUES (?, ?, 1, 'active')`)
    .run(projectId, BORING_FILE);

  rawDb
    .query(
      `INSERT INTO decisions (project_id, title, decision, reasoning, affects, status)
       VALUES (?, 'Token-bucket rate limiting', ?, ?, ?, 'active')`,
    )
    .run(projectId, DECISION_TEXT, DECISION_WHY, JSON.stringify([FRAGILE_FILE]));

  rawDb
    .query(
      `INSERT INTO issues (project_id, title, description, severity, type, affected_files, status)
       VALUES (?, 'Burst traffic exhausts bucket', 'Bucket refill is too slow under sustained burst.', 7, 'bug', ?, 'open')`,
    )
    .run(projectId, JSON.stringify([FRAGILE_FILE]));

  rawDb
    .query(
      `INSERT INTO file_correlations (project_id, file_a, file_b, cochange_count)
       VALUES (?, ?, 'src/core/engine.test.ts', 6)`,
    )
    .run(projectId, FRAGILE_FILE);

  rawDb
    .query(
      `INSERT INTO blast_summary (project_id, file_path, total_affected, affected_tests, blast_score)
       VALUES (?, ?, 12, 3, 40)`,
    )
    .run(projectId, FRAGILE_FILE);
}

beforeEach(() => {
  testDb = createTestDb();
  seed(testDb);
});

afterEach(() => {
  testDb.cleanup();
});

describe("refreshContextCache", () => {
  test("writes orientation, qualifying bundles, and meta", async () => {
    const result = await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);

    expect(result.bundles).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(testDb.tempDir, ".muninn/context/session-start.md"))).toBe(true);
    expect(existsSync(join(testDb.tempDir, ".muninn/context/meta.json"))).toBe(true);
    expect(existsSync(join(testDb.tempDir, `.muninn/context/files/${FRAGILE_FILE}.md`))).toBe(true);
  });

  test("boring files get no bundle (conditional silence)", async () => {
    await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);
    expect(existsSync(join(testDb.tempDir, `.muninn/context/files/${BORING_FILE}.md`))).toBe(false);
  });

  test("bundles carry full-fidelity decision text, reasoning, issues, and blast", async () => {
    await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);
    const bundle = readFileSync(join(testDb.tempDir, `.muninn/context/files/${FRAGILE_FILE}.md`), "utf-8");

    expect(bundle).toContain("Fragility 9/10 — Core engine, everything depends on it.");
    expect(bundle).toContain(DECISION_TEXT);
    expect(bundle).toContain(DECISION_WHY);
    expect(bundle).toContain("Burst traffic exhausts bucket");
    expect(bundle).toContain("src/core/engine.test.ts (6x)");
    expect(bundle).toContain("12 dependent file(s), 3 test(s) affected");
    // No v9 sigil formats
    expect(bundle).not.toMatch(/[DKF]\[/);
  });

  test("orientation includes fragile files, decisions, and open issues", async () => {
    await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);
    const orientation = readFileSync(join(testDb.tempDir, ".muninn/context/session-start.md"), "utf-8");

    expect(orientation).toContain(FRAGILE_FILE);
    expect(orientation).toContain("Token-bucket rate limiting");
    expect(orientation).toContain("sev 7");
  });

  test("cleans legacy v9 sidecar layout but keeps reserved names", async () => {
    const contextDir = join(testDb.tempDir, ".muninn/context");
    mkdirSync(join(contextDir, "src/old"), { recursive: true });
    writeFileSync(join(contextDir, "src/old/legacy.ts.md"), "LEGACY");
    writeFileSync(join(contextDir, "global.md"), "GLOBAL");

    const result = await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);

    expect(result.cleaned).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(contextDir, "src"))).toBe(false);
    expect(readFileSync(join(contextDir, "global.md"), "utf-8")).toBe("GLOBAL");
  });

  test("prunes bundles for files that no longer qualify", async () => {
    await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);
    testDb.rawDb.query(`UPDATE files SET fragility = 1 WHERE path = ?`).run(FRAGILE_FILE);
    testDb.rawDb.query(`UPDATE decisions SET status = 'superseded'`).run();
    testDb.rawDb.query(`UPDATE issues SET status = 'resolved'`).run();
    testDb.rawDb.query(`DELETE FROM file_correlations`).run();

    await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);

    expect(existsSync(join(testDb.tempDir, `.muninn/context/files/${FRAGILE_FILE}.md`))).toBe(false);
  });
});

describe("refreshFileBundle", () => {
  test("writes a single file's bundle without touching others", async () => {
    const wrote = await refreshFileBundle(testDb.db, testDb.projectId, testDb.tempDir, FRAGILE_FILE);
    expect(wrote).toBe(true);
    expect(existsSync(join(testDb.tempDir, `.muninn/context/files/${FRAGILE_FILE}.md`))).toBe(true);
  });

  test("returns false and removes stale bundle when file becomes boring", async () => {
    await refreshFileBundle(testDb.db, testDb.projectId, testDb.tempDir, FRAGILE_FILE);
    testDb.rawDb.query(`UPDATE files SET fragility = 1 WHERE path = ?`).run(FRAGILE_FILE);
    testDb.rawDb.query(`UPDATE decisions SET status = 'superseded'`).run();
    testDb.rawDb.query(`UPDATE issues SET status = 'resolved'`).run();
    testDb.rawDb.query(`DELETE FROM file_correlations`).run();

    const wrote = await refreshFileBundle(testDb.db, testDb.projectId, testDb.tempDir, FRAGILE_FILE);

    expect(wrote).toBe(false);
    expect(existsSync(join(testDb.tempDir, `.muninn/context/files/${FRAGILE_FILE}.md`))).toBe(false);
  });
});
