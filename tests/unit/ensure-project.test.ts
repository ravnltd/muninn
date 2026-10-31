import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProject, resolveProjectRoot } from "../../src/database/connection/ensure";
import { normalizeRemote } from "../../src/database/connection/identity";
import { createTestDb, type TestDb } from "../helpers/db-setup";

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stderr: "ignore",
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  });

// Needs git; the CI image has none (the pre-commit hook runs these on every commit)
describe.skipIf(!Bun.which("git"))("project identity", () => {
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

  test("a second checkout of the same remote joins the existing project", async () => {
    const remote = "git@github.com-work:Acme/Widget.git";
    const a = join(root, "widget-a");
    const b = join(root, "widget-b");
    for (const dir of [a, b]) {
      mkdirSync(dir);
      git(dir, "init", "-q");
      git(dir, "remote", "add", "origin", remote);
    }
    const id = await ensureProject(testDb.db, a);
    expect(await ensureProject(testDb.db, b)).toBe(id);
    const row = await testDb.db.get<{ repo_key: string }>("SELECT repo_key FROM projects WHERE id = ?", [id]);
    expect(row?.repo_key).toBe("acme/widget");
    const locs = await testDb.db.all<{ path: string }>("SELECT path FROM project_locations WHERE project_id = ? ORDER BY path", [id]);
    expect(locs.map((l) => l.path)).toEqual([a, b]);
  });

  test("an existing row found by path gets its repo key filled in", async () => {
    const dir = join(root, "legacy-keyed");
    mkdirSync(dir);
    git(dir, "init", "-q");
    git(dir, "remote", "add", "origin", "https://github.com/acme/legacy.git");
    await testDb.db.run("INSERT INTO projects (path, name) VALUES (?, 'legacy-keyed')", [dir]);
    const id = await ensureProject(testDb.db, dir);
    const row = await testDb.db.get<{ repo_key: string }>("SELECT repo_key FROM projects WHERE id = ?", [id]);
    expect(row?.repo_key).toBe("acme/legacy");
  });

  test("a legacy per-directory row is not recorded as this machine's checkout", async () => {
    const legacy = join(plain, "old");
    const count = await testDb.db.get<{ n: number }>("SELECT COUNT(*) n FROM project_locations WHERE path = ?", [legacy]);
    expect(count?.n).toBe(0);
  });
});

describe("normalizeRemote", () => {
  test("SSH, HTTPS and SSH host aliases agree on owner/repo", () => {
    expect(normalizeRemote("git@github.com:ravnltd/elsker.git")).toBe("ravnltd/elsker");
    expect(normalizeRemote("https://github.com/ravnltd/elsker")).toBe("ravnltd/elsker");
    expect(normalizeRemote("https://github.com/ravnltd/elsker.git/")).toBe("ravnltd/elsker");
    expect(normalizeRemote("ssh://git@github.com:22/RavnLtd/Elsker.git")).toBe("ravnltd/elsker");
    expect(normalizeRemote("git@github.com-dmvans:dmvans-ross/dmvans-intelligence.git")).toBe(
      "dmvans-ross/dmvans-intelligence",
    );
  });

  test("local-path remotes have no key", () => {
    expect(normalizeRemote("/srv/git/thing.git")).toBeNull();
    expect(normalizeRemote("file:///srv/git/thing.git")).toBeNull();
    expect(normalizeRemote("../thing")).toBeNull();
    expect(normalizeRemote("")).toBeNull();
  });
});

