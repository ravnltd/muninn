import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../..");
// Strip GIT_* so the tests work inside git hooks too
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

function sh(cwd: string, ...cmd: string[]): string {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}

// Needs git; the CI image has none (the pre-commit hook runs these on every commit)
describe.skipIf(!Bun.which("git"))("auto-update.sh", () => {
  let root: string;
  let dev: string;
  let install: string;
  let state: string;

  const head = (dir: string) => sh(dir, "git", "rev-parse", "HEAD");
  const update = () => Bun.spawnSync(["bash", join(install, "scripts/auto-update.sh")], { env: { ...env, MUNINN_HOME: state } });
  const log = () => readFileSync(join(state, "auto-update.log"), "utf-8");
  const pushCommit = (file: string, content: string) => {
    appendFileSync(join(dev, file), content);
    sh(dev, "git", "commit", "-qam", `change ${file}`);
    sh(dev, "git", "push", "-q", "origin", "main");
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "muninn-autoupdate-"));
    const origin = join(root, "origin.git");
    dev = join(root, "dev");
    install = join(root, "install");
    state = join(root, "state");
    sh(root, "git", "clone", "-q", "--bare", "--branch", sh(REPO, "git", "rev-parse", "--abbrev-ref", "HEAD"), REPO, origin);
    sh(origin, "git", "symbolic-ref", "HEAD", "refs/heads/main");
    sh(origin, "git", "branch", "-f", "main", "HEAD");
    // The script under test, committed on top of the current history
    sh(root, "git", "clone", "-q", "--branch", "main", origin, dev);
    copyFileSync(join(REPO, "scripts/auto-update.sh"), join(dev, "scripts/auto-update.sh"));
    sh(dev, "git", "add", "scripts/auto-update.sh");
    sh(dev, "git", "commit", "-qm", "add updater", "--allow-empty");
    sh(dev, "git", "push", "-q", "origin", "main");
    sh(root, "git", "clone", "-q", "--branch", "main", origin, install);
    for (const dir of [dev, install]) symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("does nothing when already current", () => {
    expect(update().exitCode).toBe(0);
    expect(head(install)).toBe(head(dev));
  });

  test("fast-forwards to a good commit", () => {
    pushCommit("README.md", "\nauto-update test\n");
    expect(update().exitCode).toBe(0);
    expect(head(install)).toBe(head(dev));
    expect(log()).toContain("updated");
  });

  test("rolls back a commit that breaks the build", () => {
    const before = head(install);
    pushCommit("src/index.ts", "\nexport const broken = ;\n");
    expect(update().exitCode).toBe(1);
    expect(head(install)).toBe(before);
    expect(log()).toContain("FAILED (build check)");
    sh(dev, "git", "revert", "--no-edit", "HEAD");
    sh(dev, "git", "push", "-q", "origin", "main");
  });

  test("skips a checkout with local changes", () => {
    const before = head(install);
    pushCommit("README.md", "\nanother\n");
    writeFileSync(join(install, "README.md"), "local edit\n");
    expect(update().exitCode).toBe(0);
    expect(head(install)).toBe(before);
    expect(log()).toContain("skip: local changes");
    sh(install, "git", "checkout", "-q", "README.md");
  });

  test("skips a checkout with commits origin does not have", () => {
    sh(install, "git", "commit", "-q", "--allow-empty", "-m", "local only");
    const before = head(install);
    expect(update().exitCode).toBe(0);
    expect(head(install)).toBe(before);
    expect(log()).toContain("skip: local commits not on origin/main");
  });
});
