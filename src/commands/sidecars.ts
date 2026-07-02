/**
 * Knowledge Sidecars — legacy CLI surface, now backed by the v10 context cache.
 *
 * v10: `.muninn/context/` is owned by src/v9/context-cache.ts (precomputed
 * push-delivery cache read by hooks). The old per-file sidecar layout and the
 * `@muninn` pointer comments injected into source files are retired — hooks
 * inject context automatically, so source files stay clean.
 *
 * These commands remain for CLI compatibility:
 *   sidecars generate → context cache refresh
 *   sidecars show     → print a file's bundle
 *   sidecars clean    → remove cache + strip legacy pointer comments
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { refreshContextCache, refreshFileBundle } from "../v9/context-cache";

const MUNINN_MARKER = "@muninn";
const CONTEXT_DIR = ".muninn/context";

export async function sidecarsGenerate(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
): Promise<void> {
  const result = await refreshContextCache(db, projectId, projectPath);
  console.error(
    `[context] ${result.bundles} bundle(s) written, ${result.skipped} silent, ${result.cleaned} legacy path(s) cleaned`,
  );
  console.log(JSON.stringify(result));
}

export async function sidecarsShow(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string,
): Promise<void> {
  const projectPath = process.cwd();
  const wrote = await refreshFileBundle(db, projectId, projectPath, filePath);
  if (!wrote) {
    console.error(`[context] Nothing non-obvious for ${filePath} — no bundle (by design)`);
    return;
  }
  const bundlePath = join(projectPath, CONTEXT_DIR, "files", `${filePath}.md`);
  console.log(readFileSync(bundlePath, "utf-8"));
}

export async function sidecarsClean(projectPath: string): Promise<void> {
  const contextDir = join(projectPath, CONTEXT_DIR);
  if (existsSync(contextDir)) {
    rmSync(contextDir, { recursive: true, force: true });
    console.error("[context] Removed .muninn/context/");
  }
  const stripped = stripPointerComments(projectPath);
  console.log(JSON.stringify({ removed: true, pointersStripped: stripped }));
}

/**
 * Strip legacy `@muninn` pointer comments from tracked source files.
 * v9 wrote these into file headers; v10 never does.
 */
function stripPointerComments(projectPath: string): number {
  const files = gitGrepMarkerFiles(projectPath);
  let stripped = 0;

  for (const file of files) {
    const fullPath = join(projectPath, file);
    try {
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      // Only strip header pointer comments, not code that mentions the marker
      const filtered = lines.filter(
        (line, i) => !(i < 3 && line.includes(MUNINN_MARKER) && line.includes("context in")),
      );
      if (filtered.length !== lines.length) {
        writeFileSync(fullPath, filtered.join("\n"));
        stripped++;
      }
    } catch {
      // Unreadable file — skip
    }
  }
  return stripped;
}

function gitGrepMarkerFiles(projectPath: string): string[] {
  try {
    const proc = Bun.spawnSync(["git", "grep", "-l", MUNINN_MARKER], { cwd: projectPath });
    if (proc.exitCode !== 0) return [];
    return proc.stdout.toString().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
