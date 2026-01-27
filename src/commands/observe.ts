/**
 * Observation commands
 * Lightweight notes-to-self with auto-dedup
 */

import type { DatabaseAdapter } from "../database/adapter";
import { generateEmbedding, observationToText, serializeEmbedding } from "../embeddings";
import { logError } from "../utils/errors";
import { outputSuccess } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

type ObservationType = "pattern" | "frustration" | "insight" | "dropped_thread" | "preference" | "behavior";

const VALID_TYPES: ObservationType[] = [
  "pattern",
  "frustration",
  "insight",
  "dropped_thread",
  "preference",
  "behavior",
];

// ============================================================================
// Add Observation (with auto-dedup)
// ============================================================================

export async function observeAdd(
  db: DatabaseAdapter,
  projectId: number | null,
  content: string,
  type: ObservationType = "insight",
  sessionId?: number,
  isGlobal: boolean = false
): Promise<number> {
  if (!content) {
    console.error("Usage: muninn observe <content> [--type <type>] [--global]");
    process.exit(1);
  }

  if (!VALID_TYPES.includes(type)) {
    console.error(`Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  if (isGlobal) {
    return observeAddGlobal(db, content, type);
  }

  // Check for dedup: similar observation already exists?
  const existing = await findSimilarObservation(db, projectId, content);

  if (existing) {
    // Increment frequency and update last_seen
    await db.run(
      `
      UPDATE observations
      SET frequency = frequency + 1, last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [existing.id]
    );

    console.error(`\n📝 Observation reinforced (seen ${existing.frequency + 1}x)`);
    console.error(`   "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"`);

    outputSuccess({ id: existing.id, frequency: existing.frequency + 1, deduped: true });
    return existing.id;
  }

  // Insert new observation
  const result = await db.run(
    `
    INSERT INTO observations (project_id, type, content, session_id)
    VALUES (?, ?, ?, ?)
  `,
    [projectId, type, content, sessionId ?? null]
  );

  const id = Number(result.lastInsertRowid);

  // Update FTS
  await db.run(
    `
    INSERT INTO fts_observations(rowid, content, type)
    VALUES (?, ?, ?)
  `,
    [id, content, type]
  );

  // Generate embedding async
  try {
    const embedding = await generateEmbedding(observationToText(content, type));
    if (embedding) {
      await db.run("UPDATE observations SET embedding = ? WHERE id = ?", [serializeEmbedding(embedding), id]);
    }
  } catch (error) {
    logError("observe:embedding", error);
  }

  console.error(`\n📝 Observation recorded (#${id})`);
  console.error(`   Type: ${type}`);
  console.error(`   "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"`);

  outputSuccess({ id, type, content, deduped: false });
  return id;
}

// ============================================================================
// Global Observations
// ============================================================================

async function observeAddGlobal(db: DatabaseAdapter, content: string, type: ObservationType): Promise<number> {
  // Check for dedup in global
  const existing = await db.get<{ id: number; frequency: number }>(`
    SELECT id, frequency FROM global_observations
    WHERE content = ?
  `, [content]);

  if (existing) {
    await db.run(
      `
      UPDATE global_observations
      SET frequency = frequency + 1, last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [existing.id]
    );

    console.error(`\n📝 Global observation reinforced (seen ${existing.frequency + 1}x)`);
    outputSuccess({ id: existing.id, frequency: existing.frequency + 1, deduped: true, global: true });
    return existing.id;
  }

  const result = await db.run(
    `
    INSERT INTO global_observations (type, content)
    VALUES (?, ?)
  `,
    [type, content]
  );

  const id = Number(result.lastInsertRowid);
  console.error(`\n📝 Global observation recorded (#${id})`);
  outputSuccess({ id, type, content, deduped: false, global: true });
  return id;
}

// ============================================================================
// List Observations
// ============================================================================

export async function observeList(
  db: DatabaseAdapter,
  projectId: number | null,
  options: { type?: string; limit?: number; global?: boolean } = {}
): Promise<void> {
  const limit = options.limit ?? 20;

  if (options.global) {
    const results = await db.all<{
      id: number;
      type: string;
      content: string;
      frequency: number;
      last_seen_at: string;
      created_at: string;
    }>(`
      SELECT * FROM global_observations
      ORDER BY frequency DESC, last_seen_at DESC
      LIMIT ?
    `, [limit]);

    console.error(`\n📝 Global Observations (${results.length})\n`);
    for (const obs of results) {
      console.error(`  [${obs.type}] ${obs.content.slice(0, 60)} (${obs.frequency}x)`);
    }
    outputSuccess({ observations: results, global: true });
    return;
  }

  const typeFilter = options.type ? `AND type = '${options.type}'` : "";
  const results = await db.all<{
    id: number;
    type: string;
    content: string;
    frequency: number;
    last_seen_at: string;
    created_at: string;
  }>(`
    SELECT * FROM observations
    WHERE (project_id = ?1 OR project_id IS NULL)
    ${typeFilter}
    ORDER BY frequency DESC, last_seen_at DESC
    LIMIT ?2
  `, [projectId, limit]);

  console.error(`\n📝 Observations (${results.length})\n`);
  for (const obs of results) {
    const freq = obs.frequency > 1 ? ` (${obs.frequency}x)` : "";
    console.error(`  [${obs.type}] ${obs.content.slice(0, 60)}${freq}`);
  }

  outputSuccess({ observations: results });
}

// ============================================================================
// Dedup Helper
// ============================================================================

async function findSimilarObservation(
  db: DatabaseAdapter,
  projectId: number | null,
  content: string
): Promise<{ id: number; frequency: number } | null> {
  // Exact match first
  const exact = await db.get<{ id: number; frequency: number }>(`
    SELECT id, frequency FROM observations
    WHERE (project_id = ? OR project_id IS NULL) AND content = ?
  `, [projectId, content]);

  if (exact) return exact;

  // FTS match for similar content
  try {
    const ftsMatch = await db.get<{ id: number; frequency: number }>(`
      SELECT o.id, o.frequency FROM fts_observations
      JOIN observations o ON fts_observations.rowid = o.id
      WHERE fts_observations MATCH ?1
      AND (o.project_id = ?2 OR o.project_id IS NULL)
      ORDER BY bm25(fts_observations)
      LIMIT 1
    `, [content.split(" ").slice(0, 5).join(" "), projectId]);

    // Only dedup if the FTS match is very close (check manually)
    if (ftsMatch) {
      const existing = await db.get<{ content: string }>("SELECT content FROM observations WHERE id = ?", [ftsMatch.id]);

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

export async function handleObserveCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const subCmd = args[0];

  if (subCmd === "list") {
    const typeIdx = args.indexOf("--type");
    const type = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
    const isGlobal = args.includes("--global");
    await observeList(db, projectId, { type, global: isGlobal });
    return;
  }

  // Default: add observation
  const typeIdx = args.indexOf("--type");
  const type = (typeIdx !== -1 ? args[typeIdx + 1] : "insight") as ObservationType;
  const isGlobal = args.includes("--global");

  // Filter out flags and their arguments
  const contentParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type") {
      i++;
      continue;
    }
    if (args[i] === "--global") {
      continue;
    }
    contentParts.push(args[i]);
  }
  const content = contentParts.join(" ");

  await observeAdd(db, isGlobal ? null : projectId, content, type, undefined, isGlobal);
}
