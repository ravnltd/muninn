/**
 * v10 Learned Relevance tests — injection ledger ingest, suppression, stats.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/db-setup";
import {
  ingestInjectionLog,
  getInjectionStats,
  refreshContextCache,
} from "../../src/v9/context-cache";

const COCHANGE_FILE = "src/ui/theme.ts";

let testDb: TestDb;

beforeEach(() => {
  testDb = createTestDb();
  testDb.rawDb.exec(`CREATE TABLE IF NOT EXISTS blast_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, file_path TEXT NOT NULL,
    total_affected INTEGER DEFAULT 0, affected_tests INTEGER DEFAULT 0, blast_score REAL DEFAULT 0
  )`);
});

afterEach(() => {
  testDb.cleanup();
});

function writeLog(lines: object[]): void {
  const dir = join(testDb.tempDir, ".muninn/context");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "injections.log"), lines.map((l) => JSON.stringify(l)).join("\n"));
}

function seedSession(filesTouched: string[]): void {
  testDb.rawDb
    .query(`INSERT INTO sessions (project_id, goal, files_touched) VALUES (?, 'test', ?)`)
    .run(testDb.projectId, JSON.stringify(filesTouched));
}

describe("ingestInjectionLog", () => {
  test("ingests entries, resolves acted against session edits, removes log", async () => {
    seedSession(["src/a.ts"]);
    writeLog([
      { ts: "2026-07-01T00:00:00Z", kind: "file", target: "src/a.ts", bytes: 400 },
      { ts: "2026-07-01T00:01:00Z", kind: "file", target: "src/b.ts", bytes: 200 },
      { garbage: true },
    ]);

    const count = await ingestInjectionLog(testDb.db, testDb.projectId, testDb.tempDir);

    expect(count).toBe(2);
    expect(existsSync(join(testDb.tempDir, ".muninn/context/injections.log"))).toBe(false);
    const rows = testDb.rawDb
      .query<{ target: string; acted: number }, [number]>(
        `SELECT target, acted FROM injection_ledger WHERE project_id = ? ORDER BY target`,
      )
      .all(testDb.projectId);
    expect(rows).toEqual([
      { target: "src/a.ts", acted: 1 },
      { target: "src/b.ts", acted: 0 },
    ]);
  });

  test("resolves acted when files_touched holds absolute paths (hook targets are relative)", async () => {
    // Production shape: session digests record absolute Edit paths, while
    // post-read-context.sh logs repo-relative targets.
    seedSession([join(testDb.tempDir, "src/a.ts")]);
    writeLog([{ ts: "2026-07-01T00:00:00Z", kind: "file", target: "src/a.ts", bytes: 400 }]);

    await ingestInjectionLog(testDb.db, testDb.projectId, testDb.tempDir);

    const row = testDb.rawDb
      .query<{ acted: number }, [number]>(
        `SELECT acted FROM injection_ledger WHERE project_id = ? AND target = 'src/a.ts'`,
      )
      .get(testDb.projectId);
    expect(row?.acted).toBe(1);
  });

  test("missing log is a no-op", async () => {
    expect(await ingestInjectionLog(testDb.db, testDb.projectId, testDb.tempDir)).toBe(0);
  });
});

describe("suppression", () => {
  test("cochange-only bundles stop generating after 5 ignored injections", async () => {
    // A file whose only context is co-change (no fragility, no issues)
    mkdirSync(join(testDb.tempDir, "src/ui"), { recursive: true });
    writeFileSync(join(testDb.tempDir, COCHANGE_FILE), "export const t = 1;\n");
    testDb.rawDb
      .query(`INSERT INTO files (project_id, path, fragility, status) VALUES (?, ?, 2, 'active')`)
      .run(testDb.projectId, COCHANGE_FILE);
    testDb.rawDb
      .query(`INSERT INTO file_correlations (project_id, file_a, file_b, cochange_count) VALUES (?, ?, 'src/ui/palette.ts', 8)`)
      .run(testDb.projectId, COCHANGE_FILE);

    await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);
    const bundlePath = join(testDb.tempDir, `.muninn/context/files/${COCHANGE_FILE}.md`);
    expect(existsSync(bundlePath)).toBe(true);

    // 5 injections, never acted on
    for (let i = 0; i < 5; i++) {
      testDb.rawDb
        .query(`INSERT INTO injection_ledger (project_id, kind, target, bytes, acted) VALUES (?, 'file', ?, 300, 0)`)
        .run(testDb.projectId, COCHANGE_FILE);
    }

    await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);
    expect(existsSync(bundlePath)).toBe(false);
  });

  test("fragile files are never suppressed", async () => {
    const fragile = "src/core/danger.ts";
    mkdirSync(join(testDb.tempDir, "src/core"), { recursive: true });
    writeFileSync(join(testDb.tempDir, fragile), "export const d = 1;\n");
    testDb.rawDb
      .query(`INSERT INTO files (project_id, path, fragility, fragility_reason, status) VALUES (?, ?, 9, 'do not touch', 'active')`)
      .run(testDb.projectId, fragile);
    for (let i = 0; i < 10; i++) {
      testDb.rawDb
        .query(`INSERT INTO injection_ledger (project_id, kind, target, bytes, acted) VALUES (?, 'file', ?, 300, 0)`)
        .run(testDb.projectId, fragile);
    }

    await refreshContextCache(testDb.db, testDb.projectId, testDb.tempDir);
    expect(existsSync(join(testDb.tempDir, `.muninn/context/files/${fragile}.md`))).toBe(true);
  });
});

describe("getInjectionStats", () => {
  test("aggregates counts, tokens, and acted rate", async () => {
    testDb.rawDb
      .query(`INSERT INTO injection_ledger (project_id, kind, target, bytes, acted) VALUES (?, 'file', 'a.ts', 400, 1)`)
      .run(testDb.projectId);
    testDb.rawDb
      .query(`INSERT INTO injection_ledger (project_id, kind, target, bytes, acted) VALUES (?, 'map', 'b.ts', 400, 0)`)
      .run(testDb.projectId);

    const stats = await getInjectionStats(testDb.db, testDb.projectId, 7);

    expect(stats).not.toBeNull();
    expect(stats?.injections).toBe(2);
    expect(stats?.tokens).toBe(200);
    expect(stats?.actedRate).toBe(0.5);
  });

  test("returns null with no data", async () => {
    expect(await getInjectionStats(testDb.db, testDb.projectId, 7)).toBeNull();
  });
});
