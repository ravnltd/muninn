/**
 * Projects commands: find and merge duplicate projects for the same repo.
 *
 *   muninn projects dupes                         List projects sharing a repo key
 *   muninn projects merge <from> <into> [--dry-run]  Move everything from one project into another
 *
 * Merges are explicit, never automatic: silent heuristic merging is what once
 * collapsed 172 repos into one project.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseAdapter } from "../database/adapter.js";
import { resolveProjectRoot, resolveRepoKey } from "../database/connection/identity.js";
import { outputSuccess } from "../utils/format.js";

type ProjectRow = { id: number; path: string; repo_key: string | null };
type DupeRow = ProjectRow & { files: number; memories: number; sessions: number };

export async function handleProjectsCommand(db: DatabaseAdapter, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === "dupes") return projectsDupes(db);
  if (sub === "merge") return projectsMerge(db, rest);
  console.error("Usage: muninn projects <dupes | merge <from-id> <into-id> [--dry-run]>");
}

/** Fill missing repo keys for projects whose root exists on this machine. */
async function backfillRepoKeys(db: DatabaseAdapter): Promise<number> {
  const rows = await db.all<ProjectRow>("SELECT id, path, repo_key FROM projects WHERE repo_key IS NULL");
  let filled = 0;
  for (const row of rows) {
    if (!existsSync(row.path) || resolveProjectRoot(row.path) !== row.path) continue;
    const key = resolveRepoKey(row.path);
    if (!key) continue;
    await db.run("UPDATE projects SET repo_key = ? WHERE id = ? AND repo_key IS NULL", [key, row.id]);
    filled++;
  }
  return filled;
}

async function projectsDupes(db: DatabaseAdapter): Promise<void> {
  const filled = await backfillRepoKeys(db);
  const rows = await db.all<DupeRow>(`
    SELECT p.id, p.path, p.repo_key,
      (SELECT COUNT(*) FROM files WHERE project_id = p.id) AS files,
      (SELECT COUNT(*) FROM decisions WHERE project_id = p.id)
        + (SELECT COUNT(*) FROM learnings WHERE project_id = p.id)
        + (SELECT COUNT(*) FROM issues WHERE project_id = p.id) AS memories,
      (SELECT COUNT(*) FROM sessions WHERE project_id = p.id) AS sessions
    FROM projects p
    WHERE p.repo_key IN (SELECT repo_key FROM projects WHERE repo_key IS NOT NULL GROUP BY repo_key HAVING COUNT(*) > 1)
    ORDER BY p.repo_key, p.id`);

  const groups = Map.groupBy(rows, (r) => r.repo_key as string);
  console.error(`Repo keys filled on this machine: ${filled}`);
  if (groups.size === 0) console.error("No duplicate projects.");
  for (const [key, members] of groups) {
    const into = suggestTarget(members);
    console.error(`\n${key}`);
    for (const m of members) {
      console.error(`  ${m.id === into.id ? "*" : " "} #${m.id} ${m.path}  (${m.memories} memories, ${m.files} files, ${m.sessions} sessions)`);
    }
    for (const m of members) if (m.id !== into.id) console.error(`  → muninn projects merge ${m.id} ${into.id}`);
  }
  outputSuccess({ filled, groups: Object.fromEntries(groups) });
}

/** Keep the project with the most memories, then files, then sessions; oldest on ties. */
function suggestTarget(members: DupeRow[]): DupeRow {
  const score = (m: DupeRow) => [m.memories, m.files, m.sessions, -m.id];
  return members.reduce((best, m) => {
    const [a, b] = [score(m), score(best)];
    const i = a.findIndex((v, k) => v !== b[k]);
    return i >= 0 && a[i] > b[i] ? m : best;
  });
}

async function projectsMerge(db: DatabaseAdapter, args: string[]): Promise<void> {
  const [from, into] = args.filter((a) => !a.startsWith("--")).map(Number);
  const dryRun = args.includes("--dry-run");
  if (!Number.isInteger(from) || !Number.isInteger(into) || from === into) {
    console.error("Usage: muninn projects merge <from-id> <into-id> [--dry-run]");
    return;
  }
  const result = await mergeProjects(db, from, into, dryRun);
  for (const [table, n] of Object.entries(result.rows)) console.error(`  ${table}: ${n}`);
  console.error(dryRun ? "Dry run: nothing changed." : `Merged #${from} into #${into}. Backup: ${result.backup}`);
  outputSuccess({ from, into, dryRun, ...result });
}

export type MergeResult = { rows: Record<string, number>; fileConflicts: number; backup: string | null };

/**
 * Move every row of `from` into `into` in one transaction, then delete `from`.
 * Where both have a row under a project-scoped unique key, the newer file row
 * wins for files; for other tables (derived caches) `into` keeps its row.
 * Writes a JSON backup of both projects' rows first.
 */
export async function mergeProjects(db: DatabaseAdapter, from: number, into: number, dryRun: boolean): Promise<MergeResult> {
  const projects = await db.all<ProjectRow>("SELECT id, path, repo_key FROM projects WHERE id IN (?, ?)", [from, into]);
  const src = projects.find((p) => p.id === from);
  const dst = projects.find((p) => p.id === into);
  if (!src || !dst) throw new Error(`Project #${src ? into : from} does not exist`);
  if (src.repo_key && dst.repo_key && src.repo_key !== dst.repo_key) {
    throw new Error(`Refusing to merge different repos: ${src.repo_key} into ${dst.repo_key}`);
  }

  const tables = await projectTables(db);
  const rows = await countRows(db, tables, from);
  const conflicts = await db.all<{ id: number }>(OLDER_TARGET_FILES, [from, into]);
  if (dryRun) return { rows, fileConflicts: conflicts.length, backup: null };

  const backup = await writeBackup(db, tables, from, into);
  await db.batch(mergeStatements(tables, from, into));
  return { rows, fileConflicts: conflicts.length, backup };
}

// Target-project file rows that collide with a newer source row by path
const OLDER_TARGET_FILES = `
  SELECT i.id FROM files i JOIN files f ON f.path = i.path AND f.project_id = ?
  WHERE i.project_id = ? AND COALESCE(f.updated_at, f.created_at, '') > COALESCE(i.updated_at, i.created_at, '')`;

// fts_files follows files through its files_ad/files_au triggers
function mergeStatements(tables: string[], from: number, into: number) {
  const stmts: Array<{ sql: string; params?: unknown[] }> = [];
  if (tables.includes("files")) stmts.push({ sql: `DELETE FROM files WHERE id IN (${OLDER_TARGET_FILES})`, params: [from, into] });
  for (const t of tables) stmts.push({ sql: `UPDATE OR IGNORE ${t} SET project_id = ? WHERE project_id = ?`, params: [into, from] });
  // Whatever could not move collided with a row the target keeps
  for (const t of tables) stmts.push({ sql: `DELETE FROM ${t} WHERE project_id = ?`, params: [from] });
  stmts.push({
    sql: `UPDATE projects SET
            previous_paths = json_insert(COALESCE(previous_paths, '[]'), '$[#]', (SELECT path FROM projects WHERE id = ?)),
            repo_key = COALESCE(repo_key, (SELECT repo_key FROM projects WHERE id = ?))
          WHERE id = ?`,
    params: [from, from, into],
  });
  stmts.push({ sql: "DELETE FROM projects WHERE id = ?", params: [from] });
  return stmts;
}

async function projectTables(db: DatabaseAdapter): Promise<string[]> {
  const rows = await db.all<{ name: string }>(`
    SELECT DISTINCT m.name FROM sqlite_master m, pragma_table_info(m.name) c
    WHERE m.type = 'table' AND c.name = 'project_id' ORDER BY m.name`);
  return rows.map((r) => r.name);
}

async function countRows(db: DatabaseAdapter, tables: string[], projectId: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE project_id = ?`, [projectId]);
    if (row && row.n > 0) counts[t] = row.n;
  }
  return counts;
}

async function writeBackup(db: DatabaseAdapter, tables: string[], from: number, into: number): Promise<string> {
  const data: Record<string, unknown[]> = {
    projects: await db.all("SELECT * FROM projects WHERE id IN (?, ?)", [from, into]),
  };
  for (const t of tables) data[t] = await db.all(`SELECT * FROM ${t} WHERE project_id IN (?, ?)`, [from, into]);
  const dir = join(process.env.MUNINN_HOME || join(process.env.HOME || homedir(), ".muninn"), "merge-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${from}-into-${into}.json`);
  // Blobs (embeddings) as base64 so the backup is plain JSON
  const blobs = (_k: string, v: unknown) => (v instanceof Uint8Array ? { base64: Buffer.from(v).toString("base64") } : v);
  writeFileSync(file, JSON.stringify(data, blobs));
  return file;
}
