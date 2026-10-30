import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProject, resolveProjectRoot } from "../../src/database/connection/ensure";
import { createTestDb, type TestDb } from "../helpers/db-setup";

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stderr: "ignore",
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  });

describe("project identity", () => {
  let root: string;
  let repo: string;
  let worktree: string;
  let plain: string;
  let testDb: TestDb;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "muninn-ensure-")));
    repo = join(root, "repo");
    worktree = join(root, "repo-lane");
    plain = join(root, "not-a-repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(plain);
    git(repo, "init", "-q");
    git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    git(repo, "worktree", "add", "-q", worktree);
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
    rmSync(root, { recursive: true, force: true });
  });

  test("subdirectories and worktrees resolve to the main checkout", () => {
    expect(resolveProjectRoot(repo)).toBe(repo);
    expect(resolveProjectRoot(join(repo, "src"))).toBe(repo);
    expect(resolveProjectRoot(worktree)).toBe(repo);
  });

  test("directories outside git resolve to $HOME", () => {
    expect(resolveProjectRoot(plain)).toBe(process.env.HOME as string);
  });

  test("repo, subdir and worktree share one project", async () => {
    const id = await ensureProject(testDb.db, repo);
    expect(await ensureProject(testDb.db, join(repo, "src"))).toBe(id);
    expect(await ensureProject(testDb.db, worktree)).toBe(id);
    const rows = await testDb.db.all<{ path: string }>("SELECT path FROM projects WHERE path LIKE ?", [`${root}%`]);
    expect(rows.map((r) => r.path)).toEqual([repo]);
  });

  test("a legacy row keyed by a raw directory is still used when the root has none", async () => {
    const legacy = join(plain, "old");
    mkdirSync(legacy);
    await testDb.db.run("DELETE FROM projects WHERE path = ?", [process.env.HOME as string]);
    await testDb.db.run("INSERT INTO projects (path, name) VALUES (?, 'old')", [legacy]);
    const { id } = (await testDb.db.get<{ id: number }>("SELECT id FROM projects WHERE path = ?", [legacy])) as { id: number };
    expect(await ensureProject(testDb.db, legacy)).toBe(id);
  });
});
