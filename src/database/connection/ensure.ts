/**
 * Project ensure + sync + closeAll utilities.
 */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseAdapter } from "../adapter.js";
import { getConfig, getGlobalDb, LOCAL_DB_DIR, LOCAL_DB_NAME } from "./global.js";
import { closeGlobalDb } from "./global.js";
import { closeProjectDb } from "./project.js";

// ---------------------------------------------------------------------------
// Project Management
// ---------------------------------------------------------------------------

export async function ensureProject(adapter: DatabaseAdapter, projectPath?: string): Promise<number> {
  const path = projectPath || process.cwd();
  const name = basename(path);

  const existing = await adapter.get<{ id: number }>("SELECT id FROM projects WHERE path = ?", [path]);

  if (existing) {
    syncProjectToGlobal(path, name);
    return existing.id;
  }

  // Detect project rename: if no match by path, check for a project
  // with the most data that likely IS this project under an old path.
  // ONLY for local mode — local DBs are project-scoped (one project per DB),
  // so a stale path means the project was renamed/moved.
  // In HTTP mode the DB is shared across all projects, so rename detection
  // would incorrectly merge unrelated projects.
  if (getConfig().mode !== "http") {
    const renamed = await adapter.get<{ id: number; path: string }>(`
      SELECT p.id, p.path FROM projects p
      LEFT JOIN files f ON f.project_id = p.id
      GROUP BY p.id
      ORDER BY COUNT(f.id) DESC
      LIMIT 1
    `);

    if (renamed && renamed.path !== path) {
      // Preserve old path in rename history
      const prev = await adapter.get<{ previous_paths: string | null }>(
        "SELECT previous_paths FROM projects WHERE id = ?",
        [renamed.id]
      );
      const history: string[] = prev?.previous_paths ? JSON.parse(prev.previous_paths) : [];
      if (!history.includes(renamed.path)) {
        history.push(renamed.path);
      }
      await adapter.run("UPDATE projects SET path = ?, name = ?, previous_paths = ? WHERE id = ?", [
        path,
        name,
        JSON.stringify(history),
        renamed.id,
      ]);
      await syncProjectToGlobal(path, name);
      return renamed.id;
    }
  }

  const result = await adapter.run("INSERT INTO projects (path, name) VALUES (?, ?)", [path, name]);

  await syncProjectToGlobal(path, name);
  return Number(result.lastInsertRowid);
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
