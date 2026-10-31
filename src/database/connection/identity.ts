/**
 * Project identity: which project a directory belongs to.
 *
 * A project is a repo, not a path. The same repo checked out on several
 * machines or paths shares one project, matched by its git remote.
 */

import { homedir } from "node:os";
import { dirname } from "node:path";

/** Run git with inherited GIT_* removed: inside git hooks GIT_DIR etc. override -C. */
function git(dir: string, args: string[]): string | null {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const proc = Bun.spawnSync(["git", "-C", dir, ...args], { stderr: "ignore", env });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : null;
}

/**
 * The directory a project is keyed by: the main checkout for git worktrees and
 * subdirectories, $HOME outside any repo. Without this every cwd (/tmp, $HOME,
 * each worktree) became its own project on the hub.
 */
export function resolveProjectRoot(dir: string): string {
  try {
    const out = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]);
    if (out === null) return process.env.HOME || homedir();
    const [commonDir, toplevel] = out.split("\n");
    // Worktrees share the main checkout's .git; submodules and bare repos don't end in /.git
    return commonDir.endsWith("/.git") ? dirname(commonDir) : toplevel || dir;
  } catch {
    return dir; // git not installed: keep the old per-directory behaviour
  }
}

/**
 * owner/repo from a remote URL, lowercased, so SSH, HTTPS and SSH host aliases
 * (git@github.com-work:owner/repo.git) agree. Local-path remotes have no key.
 */
export function normalizeRemote(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("file:") || trimmed.startsWith(".")) return null;
  const parts = trimmed.split(/[/:]/).filter(Boolean);
  if (parts.length < 3) return null; // need at least host + owner + repo
  return parts.slice(-2).join("/").toLowerCase();
}

/** The repo key for a project root, from its origin remote; null when it has none. */
export function resolveRepoKey(root: string): string | null {
  try {
    const url = git(root, ["config", "--get", "remote.origin.url"]);
    return url ? normalizeRemote(url) : null;
  } catch {
    return null;
  }
}
