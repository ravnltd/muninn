/**
 * Observation commands
 * Lightweight notes-to-self with auto-dedup
 */

import type { Database } from "bun:sqlite";
import { outputSuccess } from "../utils/format";
import { generateEmbedding, serializeEmbedding, observationToText } from "../embeddings";
import { logError } from "../utils/errors";

// ============================================================================
// Types
// ============================================================================

type ObservationType = 'pattern' | 'frustration' | 'insight' | 'dropped_thread' | 'preference' | 'behavior';

const VALID_TYPES: ObservationType[] = ['pattern', 'frustration', 'insight', 'dropped_thread', 'preference', 'behavior'];

// ============================================================================
// Add Observation (with auto-dedup)
// ============================================================================

export async function observeAdd(
  db: Database,
  projectId: number | null,
  content: string,
  type: ObservationType = 'insight',
  sessionId?: number,
  isGlobal: boolean = false
): Promise<number> {
  if (!content) {
    console.error("Usage: context observe <content> [--type <type>] [--global]");
    process.exit(1);
  }

  if (!VALID_TYPES.includes(type)) {
    console.error(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  if (isGlobal) {
    return observeAddGlobal(db, content, type);
  }

  // Check for dedup: similar observation already exists?
  const existing = findSimilarObservation(db, projectId, content);

  if (existing) {
    // Increment frequency and update last_seen
    db.run(`
      UPDATE observations
      SET frequency = frequency + 1, last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [existing.id]);

    console.error(`\n📝 Observation reinforced (seen ${existing.frequency + 1}x)`);
    console.error(`   "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`);

    outputSuccess({ id: existing.id, frequency: existing.frequency + 1, deduped: true });
    return existing.id;
  }

  // Insert new observation
  const result = db.run(`
    INSERT INTO observations (project_id, type, content, session_id)
    VALUES (?, ?, ?, ?)
  `, [projectId, type, content, sessionId ?? null]);

  const id = Number(result.lastInsertRowid);

  // Update FTS
  db.run(`
    INSERT INTO fts_observations(rowid, content, type)
    VALUES (?, ?, ?)
  `, [id, content, type]);

  // Generate embedding async
  try {
    const embedding = await generateEmbedding(observationToText(content, type));
    if (embedding) {
      db.run("UPDATE observations SET embedding = ? WHERE id = ?", [
        serializeEmbedding(embedding),
        id,
      ]);
    }
  } catch (error) {
    logError("observe:embedding", error);
  }

  console.error(`\n📝 Observation recorded (#${id})`);
  console.error(`   Type: ${type}`);
  console.error(`   "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`);

  outputSuccess({ id, type, content, deduped: false });
  return id;
}

// ============================================================================
// Global Observations
// ============================================================================

function observeAddGlobal(db: Database, content: string, type: ObservationType): number {
  // Check for dedup in global
  const existing = db.query<{ id: number; frequency: number }, [string]>(`
    SELECT id, frequency FROM global_observations
    WHERE content = ?
  `).get(content);

  if (existing) {
    db.run(`
      UPDATE global_observations
      SET frequency = frequency + 1, last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [existing.id]);

    console.error(`\n📝 Global observation reinforced (seen ${existing.frequency + 1}x)`);
    outputSuccess({ id: existing.id, frequency: existing.frequency + 1, deduped: true, global: true });
    return existing.id;
  }

  const result = db.run(`
    INSERT INTO global_observations (type, content)
    VALUES (?, ?)
  `, [type, content]);

  const id = Number(result.lastInsertRowid);
  console.error(`\n📝 Global observation recorded (#${id})`);
  outputSuccess({ id, type, content, deduped: false, global: true });
  return id;
}

// ============================================================================
// List Observations
// ============================================================================

export function observeList(
  db: Database,
  projectId: number | null,
  options: { type?: string; limit?: number; global?: boolean } = {}
): void {
  const limit = options.limit ?? 20;

  if (options.global) {
    const results = db.query<{
      id: number; type: string; content: string; frequency: number;
      last_seen_at: string; created_at: string;
    }, [number]>(`
      SELECT * FROM global_observations
      ORDER BY frequency DESC, last_seen_at DESC
      LIMIT ?
    `).all(limit);

    console.error(`\n📝 Global Observations (${results.length})\n`);
    for (const obs of results) {
      console.error(`  [${obs.type}] ${obs.content.slice(0, 60)} (${obs.frequency}x)`);
    }
    outputSuccess({ observations: results, global: true });
    return;
  }

  const typeFilter = options.type ? `AND type = '${options.type}'` : '';
  const results = db.query<{
    id: number; type: string; content: string; frequency: number;
    last_seen_at: string; created_at: string;
  }, [number | null, number]>(`
    SELECT * FROM observations
    WHERE (project_id = ?1 OR project_id IS NULL)
    ${typeFilter}
    ORDER BY frequency DESC, last_seen_at DESC
    LIMIT ?2
  `).all(projectId, limit);

  console.error(`\n📝 Observations (${results.length})\n`);
  for (const obs of results) {
    const freq = obs.frequency > 1 ? ` (${obs.frequency}x)` : '';
    console.error(`  [${obs.type}] ${obs.content.slice(0, 60)}${freq}`);
  }

  outputSuccess({ observations: results });
}

// ============================================================================
// Dedup Helper
// ============================================================================

function findSimilarObservation(
  db: Database,
  projectId: number | null,
  content: string
): { id: number; frequency: number } | null {
  // Exact match first
  const exact = db.query<{ id: number; frequency: number }, [number | null, string]>(`
    SELECT id, frequency FROM observations
    WHERE (project_id = ? OR project_id IS NULL) AND content = ?
  `).get(projectId, content);

  if (exact) return exact;

  // FTS match for similar content
  try {
    const ftsMatch = db.query<{ id: number; frequency: number }, [string, number | null]>(`
      SELECT o.id, o.frequency FROM fts_observations
      JOIN observations o ON fts_observations.rowid = o.id
      WHERE fts_observations MATCH ?1
      AND (o.project_id = ?2 OR o.project_id IS NULL)
      ORDER BY bm25(fts_observations)
      LIMIT 1
    `).get(content.split(' ').slice(0, 5).join(' '), projectId);

    // Only dedup if the FTS match is very close (check manually)
    if (ftsMatch) {
      const existing = db.query<{ content: string }, [number]>(
        "SELECT content FROM observations WHERE id = ?"
      ).get(ftsMatch.id);

      if (existing && isSimilarEnough(content, existing.content)) {
        return ftsMatch;
      }
    }
  } catch {
    // FTS might not be populated yet
  }

  return null;
}

/**
 * Simple similarity check: >80% word overlap
 */
function isSimilarEnough(a: string, b: string): boolean {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  const maxLen = Math.max(wordsA.size, wordsB.size);
  return maxLen > 0 && overlap / maxLen > 0.8;
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleObserveCommand(
  db: Database,
  projectId: number,
  args: string[]
): Promise<void> {
  const subCmd = args[0];

  if (subCmd === "list") {
    const typeIdx = args.indexOf("--type");
    const type = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
    const isGlobal = args.includes("--global");
    observeList(db, projectId, { type, global: isGlobal });
    return;
  }

  // Default: add observation
  const typeIdx = args.indexOf("--type");
  const type = (typeIdx !== -1 ? args[typeIdx + 1] : 'insight') as ObservationType;
  const isGlobal = args.includes("--global");

  // Filter out flags and their arguments
  const contentParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type") { i++; continue; }
    if (args[i] === "--global") { continue; }
    contentParts.push(args[i]);
  }
  const content = contentParts.join(" ");

  await observeAdd(db, isGlobal ? null : projectId, content, type, undefined, isGlobal);
}
