import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mergeProjects } from "../../src/commands/projects";
import { createTestDb, type TestDb } from "../helpers/db-setup";

describe("projects merge", () => {
  let t: TestDb;
  let from: number;

  beforeEach(async () => {
    t = createTestDb();
    const r = await t.db.run("INSERT INTO projects (path, name, repo_key) VALUES ('/Users/x/app', 'app', 'acme/app')");
    from = Number(r.lastInsertRowid);
    const run = (sql: string, params: unknown[]) => t.db.run(sql, params);
    await run("INSERT INTO decisions (project_id, title, decision) VALUES (?, 'Use Zod', 'at every boundary')", [from]);
    await run("INSERT INTO sessions (project_id, goal) VALUES (?, 'mac work')", [from]);
    await run("INSERT INTO files (project_id, path, purpose, updated_at) VALUES (?, 'src/a.ts', 'newer purpose', '2026-10-30')", [from]);
    await run("INSERT INTO files (project_id, path, purpose, updated_at) VALUES (?, 'src/b.ts', 'older purpose', '2026-01-01')", [from]);
    await run("INSERT INTO files (project_id, path, purpose) VALUES (?, 'src/only-mac.ts', 'mac only')", [from]);
    await run("INSERT INTO files (project_id, path, purpose, updated_at) VALUES (?, 'src/a.ts', 'stale purpose', '2026-01-01')", [t.projectId]);
    await run("INSERT INTO files (project_id, path, purpose, updated_at) VALUES (?, 'src/b.ts', 'current purpose', '2026-10-30')", [t.projectId]);
  });

  afterEach(() => t.cleanup());

  test("moves memories and sessions, keeps the newer file on conflict, deletes the source", async () => {
    const result = await mergeProjects(t.db, from, t.projectId, false);

    expect(result.fileConflicts).toBe(1);
    expect(result.backup && existsSync(result.backup)).toBe(true);
    expect(JSON.parse(readFileSync(result.backup as string, "utf-8")).decisions).toHaveLength(1);

    const files = await t.db.all<{ path: string; purpose: string }>(
      "SELECT path, purpose FROM files WHERE project_id = ? ORDER BY path",
      [t.projectId],
    );
    expect(files).toEqual([
      { path: "src/a.ts", purpose: "newer purpose" },
      { path: "src/b.ts", purpose: "current purpose" },
      { path: "src/only-mac.ts", purpose: "mac only" },
    ]);
    const count = (sql: string) => t.db.get<{ n: number }>(sql, [from]).then((r) => r?.n);
    expect(await count("SELECT COUNT(*) n FROM decisions WHERE project_id = ?")).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM projects WHERE id = ?")).toBe(0);
    const target = await t.db.get<{ previous_paths: string; repo_key: string }>(
      "SELECT previous_paths, repo_key FROM projects WHERE id = ?",
      [t.projectId],
    );
    expect(JSON.parse(target?.previous_paths ?? "[]")).toContain("/Users/x/app");
    expect(target?.repo_key).toBe("acme/app");
    const moved = await t.db.get<{ n: number }>("SELECT COUNT(*) n FROM decisions WHERE project_id = ?", [t.projectId]);
    expect(moved?.n).toBe(1);
  });

  test("refuses to merge projects with different repo keys", async () => {
    await t.db.run("UPDATE projects SET repo_key = 'acme/other' WHERE id = ?", [t.projectId]);
    await expect(mergeProjects(t.db, from, t.projectId, false)).rejects.toThrow("different repos");
  });

  test("refuses a missing project", async () => {
    await expect(mergeProjects(t.db, from, 9999, false)).rejects.toThrow("does not exist");
  });

  test("dry run reports without changing anything", async () => {
    const result = await mergeProjects(t.db, from, t.projectId, true);
    expect(result.backup).toBeNull();
    expect(result.rows.files).toBe(3);
    const still = await t.db.get<{ n: number }>("SELECT COUNT(*) n FROM projects WHERE id = ?", [from]);
    expect(still?.n).toBe(1);
  });
});
