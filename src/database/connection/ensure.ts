/**
 * Project ensure + sync + closeAll utilities.
 */

import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseAdapter } from "../adapter.js";
import { getGlobalDb, LOCAL_DB_DIR, LOCAL_DB_NAME } from "./global.js";
import { closeGlobalDb } from "./global.js";
import { resolveProjectRoot, resolveRepoKey } from "./identity.js";
import { closeProjectDb } from "./project.js";

export { resolveProjectRoot } from "./identity.js";

// ---------------------------------------------------------------------------
// Project Management
// ---------------------------------------------------------------------------

type Match = { id: number; prio: number; repo_key: string | null; loc_project: number | null; loc_fresh: number | null };

// One round trip, best match first: this machine's recorded checkout, then the
// root path, then a legacy row keyed by the raw cwd, then the repo's remote.
const FIND_PROJECT = `
  SELECT m.id, m.prio, p.repo_key,
    (SELECT project_id FROM project_locations WHERE machine = ? AND path = ?) AS loc_project,
    (SELECT last_seen > datetime('now', '-1 day') FROM project_locations WHERE machine = ? AND path = ?) AS loc_fresh
  FROM (
    SELECT project_id AS id, 1 AS prio FROM project_locations WHERE machine = ? AND path = ?
    UNION ALL SELECT id, 2 FROM projects WHERE path = ?
    UNION ALL SELECT id, 3 FROM projects WHERE path = ?
    UNION ALL SELECT id, 4 FROM projects WHERE repo_key = ?
  ) m JOIN projects p ON p.id = m.id
  ORDER BY m.prio, m.id LIMIT 1`;

export async function ensureProject(adapter: DatabaseAdapter, projectPath?: string): Promise<number> {
  const cwd = projectPath || process.cwd();
  const path = resolveProjectRoot(cwd);
  const repoKey = resolveRepoKey(path);
  const machine = hostname();

  const loc = [machine, path];
  const match = await adapter.get<Match>(FIND_PROJECT, [...loc, ...loc, ...loc, path, cwd, repoKey]);
  const id = match
    ? match.id
    : Number(
        (await adapter.run("INSERT INTO projects (path, name, repo_key) VALUES (?, ?, ?)", [path, basename(path), repoKey]))
          .lastInsertRowid
      );

  // A legacy per-directory row is used as-is but never becomes this checkout's identity
  if (match?.prio !== 3) await recordCheckout(adapter, match, { id, machine, path, repoKey });

  syncProjectToGlobal(path, basename(path));
  return id;
}

/** Remember this checkout and the repo's key; writes only when something changed or went stale. */
async function recordCheckout(
  adapter: DatabaseAdapter,
  match: Match | null | undefined,
  c: { id: number; machine: string; path: string; repoKey: string | null }
): Promise<void> {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  if (match && c.repoKey && match.repo_key !== c.repoKey) {
    statements.push({ sql: "UPDATE projects SET repo_key = ? WHERE id = ?", params: [c.repoKey, c.id] });
  }
  if (match?.loc_project !== c.id || !match?.loc_fresh) {
    statements.push({
      sql: `INSERT INTO project_locations (project_id, machine, path) VALUES (?, ?, ?)
            ON CONFLICT(machine, path) DO UPDATE SET project_id = excluded.project_id, last_seen = CURRENT_TIMESTAMP`,
      params: [c.id, c.machine, c.path],
    });
  }
  if (statements.length > 0) await adapter.batch(statements);
}

// ---------------------------------------------------------------------------
// Global Sync
// ---------------------------------------------------------------------------

const syncedProjects = new Set<string>();

async function syncProjectToGlobal(projectPath: string, projectName: string): Promise<void> {
  if (syncedProjects.has(projectPath)) return;

  const localDbPath = join(projectPath, LOCAL_DB_DIR, LOCAL_DB_NAME);
  if (!existsSync(localDbPath)) return;

  try {
    const globalAdapter = await getGlobalDb();

    // Skip if this path is a subdirectory of an existing project
    const parentProject = await globalAdapter.get<{ path: string }>(
      "SELECT path FROM projects WHERE ? LIKE path || '/%'",
      [projectPath]
    );
    if (parentProject) {
      syncedProjects.add(projectPath); // Don't check again
      return;
    }

    const existing = await globalAdapter.get<{ id: number; name: string }>(
      "SELECT id, name FROM projects WHERE path = ?",
      [projectPath]
    );

    if (!existing) {
      await globalAdapter.run("INSERT INTO projects (path, name, status) VALUES (?, ?, 'active')", [
        projectPath,
        projectName,
        "active",
      ]);
    } else if (existing.name !== projectName) {
      await globalAdapter.run("UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
        projectName,
        existing.id,
      ]);
    }
    syncedProjects.add(projectPath);
  } catch {
    // Non-fatal: global sync failure shouldn't break local operations
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function closeAll(): void {
  closeGlobalDb();
  closeProjectDb();
}
