// @muninn — context in .muninn/context/
/**
 * v9 Remember — The Only Write Tool
 *
 * Replaces muninn_decision_add and muninn_learn_add with a single
 * natural-language tool that auto-categorizes input.
 *
 * Usage:
 *   remember("chose token-bucket over sliding-window for rate limiting because simpler")
 *   → Auto-detected as: decision
 *
 *   remember("libsql connections need explicit close in tests")
 *   → Auto-detected as: learning (gotcha)
 *
 *   remember("always use Zod at API boundaries", { type: "decision" })
 *   → Explicit type override
 */

import type { DatabaseAdapter } from "../database/adapter.js";
import { publishEvent } from "../lib/redis.js";
import { silentCatch } from "../utils/silent-catch.js";

// ============================================================================
// File Hash Snapshot
// ============================================================================

/** Snapshot content hashes of files for decision drift detection */
async function snapshotFileHashes(
  db: DatabaseAdapter,
  projectId: number,
  files: string[],
): Promise<string | null> {
  const snapshot: Record<string, string> = {};

  for (const filePath of files) {
    const file = await db.get<{ content_hash: string | null }>(
      `SELECT content_hash FROM files WHERE project_id = ? AND path = ?`,
      [projectId, filePath],
    ).catch(() => null);

    if (file?.content_hash) {
      snapshot[filePath] = file.content_hash;
    }
  }

  return Object.keys(snapshot).length > 0 ? JSON.stringify(snapshot) : null;
}

// ============================================================================
// Types
// ============================================================================

type RememberType = "decision" | "learning";

interface RememberInput {
  content: string;
  type?: RememberType;
  files?: string[];
  id?: number;
  supersedes?: number;
  alternatives?: string[];
  revisit_when?: string;
  durability?: "permanent" | "project" | "session";
}

interface RememberResult {
  id: number;
  detectedType: RememberType;
  title: string;
  deduplicated: boolean;
  existingId?: number;
  amended?: boolean;
  supersededId?: number;
  similarWarnings?: Array<{ id: number; title: string; similarity: number }>;
}

// ============================================================================
// Auto-Categorization
// ============================================================================

const DECISION_SIGNALS = [
  /\bchose\b/i,
  /\bdecided\b/i,
  /\bpicked\b/i,
  /\bselected\b/i,
  /\bwent with\b/i,
  /\bover\b.*\bbecause\b/i,
  /\binstead of\b/i,
  /\brather than\b/i,
  /\bwill use\b/i,
  /\bswitched to\b/i,
  /\badopted\b/i,
  /\bapproach:/i,
  /\bstrategy:/i,
  /\barchitecture:/i,
];

function detectType(content: string): RememberType {
  // Check for decision signals
  for (const pattern of DECISION_SIGNALS) {
    if (pattern.test(content)) return "decision";
  }

  // Default to learning
  return "learning";
}

/**
 * Extract a short title from the content.
 * Takes the first sentence or first 60 chars.
 */
function extractTitle(content: string): string {
  // First sentence
  const sentenceEnd = content.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd <= 80) {
    return content.slice(0, sentenceEnd + 1);
  }

  // First 60 chars at word boundary
  if (content.length <= 60) return content;

  const cutoff = content.lastIndexOf(" ", 60);
  return content.slice(0, cutoff > 20 ? cutoff : 60);
}

/**
 * Detect learning category from content.
 */
function detectCategory(content: string): string {
  const lc = content.toLowerCase();

  if (lc.includes("never") || lc.includes("always") || lc.includes("must") || lc.includes("warning")) {
    return "gotcha";
  }
  if (lc.includes("pattern") || lc.includes("convention") || lc.includes("standard")) {
    return "pattern";
  }
  if (lc.includes("prefer") || lc.includes("preference") || lc.includes("like to")) {
    return "preference";
  }
  return "convention";
}

// ============================================================================
// Deduplication
// ============================================================================

async function findDuplicate(
  db: DatabaseAdapter,
  projectId: number,
  type: RememberType,
  title: string,
  content: string,
): Promise<{ id: number; title: string } | null> {
  const table = type === "decision" ? "decisions" : "learnings";

  // Try exact title match first
  const exactMatch = await db.get<{ id: number; title: string }>(
    `SELECT id, title FROM ${table}
     WHERE project_id = ? AND title = ?${type === "decision" ? " AND status = 'active'" : ""}`,
    [projectId, title],
  ).catch(() => null);

  if (exactMatch) return exactMatch;

  // Try FTS for similar content
  const ftsTable = type === "decision" ? "fts_decisions" : "fts_learnings";
  try {
    // Extract key words for FTS
    const words = title.split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
    if (words.length === 0) return null;

    const ftsQuery = words.map((w) => `"${w}"`).join(" ");
    const col = type === "decision" ? "d" : "l";

    const similar = await db.get<{ id: number; title: string }>(
      `SELECT ${col}.id, ${col}.title FROM ${ftsTable}
       JOIN ${table} ${col} ON ${ftsTable}.rowid = ${col}.id
       WHERE ${ftsTable} MATCH ?1 AND ${col}.project_id = ?2${type === "decision" ? ` AND ${col}.status = 'active'` : ""}
       ORDER BY bm25(${ftsTable}) LIMIT 1`,
      [ftsQuery, projectId],
    );

    if (similar) {
      // Check if titles are substantially similar (>70% word overlap)
      const titleWords = new Set(title.toLowerCase().split(/\s+/));
      const matchWords = similar.title.toLowerCase().split(/\s+/);
      const overlap = matchWords.filter((w) => titleWords.has(w)).length;
      const similarity = overlap / Math.max(titleWords.size, matchWords.length);

      if (similarity > 0.7) return similar;
    }
  } catch {
    // FTS might fail
  }

  // Try vector similarity if available
  try {
    const { vectorSearch } = await import("../database/queries/vector.js");
    const vectorResults = await vectorSearch(db, content, projectId, {
      limit: 1,
      minSimilarity: 0.9,
      tables: [table],
    });

    if (vectorResults.length > 0) {
      return { id: vectorResults[0].id, title: vectorResults[0].title };
    }
  } catch {
    // Vector search not available
  }

  return null;
}

// ============================================================================
// Similarity Detection (Advisory)
// ============================================================================

async function findSimilar(
  db: DatabaseAdapter,
  projectId: number,
  type: RememberType,
  content: string,
  excludeId: number,
): Promise<Array<{ id: number; title: string; similarity: number }>> {
  try {
    const { vectorSearch } = await import("../database/queries/vector.js");
    const table = type === "decision" ? "decisions" : "learnings";
    const results = await vectorSearch(db, content, projectId, {
      limit: 3,
      minSimilarity: 0.55,
      tables: [table],
    });
    return results
      .filter((r: { id: number }) => r.id !== excludeId)
      .map((r: { id: number; title: string; similarity: number }) => ({
        id: r.id,
        title: r.title,
        similarity: r.similarity,
      }));
  } catch {
    return [];
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function remember(
  db: DatabaseAdapter,
  projectId: number,
  input: RememberInput,
): Promise<RememberResult> {
  const type = input.type ?? detectType(input.content);
  const title = extractTitle(input.content);
  const content = input.content;

  // --- Amend by ID ---
  if (input.id) {
    const decision = await db.get<{ id: number; title: string }>(
      "SELECT id, title FROM decisions WHERE id = ? AND project_id = ?",
      [input.id, projectId],
    );

    if (decision) {
      const sets: string[] = ["decision = ?", "reasoning = ?", "updated_at = datetime('now')"];
      const params: unknown[] = [content, content];
      if (input.alternatives) { sets.push("alternatives = ?"); params.push(JSON.stringify(input.alternatives)); }
      if (input.revisit_when) { sets.push("consequences = ?"); params.push(input.revisit_when); }
      if (input.files) { sets.push("affects = ?"); params.push(JSON.stringify(input.files)); }
      params.push(input.id);
      await db.run(`UPDATE decisions SET ${sets.join(", ")} WHERE id = ?`, params);

      // Update FTS (best-effort)
      try {
        await db.run("DELETE FROM fts_decisions WHERE rowid = ?", [input.id]);
        await db.run(
          "INSERT INTO fts_decisions (rowid, title, decision, reasoning) VALUES (?, ?, ?, ?)",
          [input.id, decision.title, content, content],
        );
      } catch { /* FTS update best-effort */ }

      if (input.durability && input.durability !== "project") {
        db.run("UPDATE decisions SET durability = ? WHERE id = ?", [input.durability, input.id]).catch(() => {});
      }

      return { id: input.id, detectedType: "decision", title: decision.title, deduplicated: false, amended: true };
    }

    const learning = await db.get<{ id: number; title: string }>(
      "SELECT id, title FROM learnings WHERE id = ? AND project_id = ?",
      [input.id, projectId],
    );

    if (learning) {
      const sets: string[] = ["content = ?", "updated_at = datetime('now')", "times_applied = times_applied + 1"];
      const params: unknown[] = [content];
      if (input.files) { sets.push("context = ?"); params.push(JSON.stringify(input.files)); }
      params.push(input.id);
      await db.run(`UPDATE learnings SET ${sets.join(", ")} WHERE id = ?`, params);

      // Update FTS (best-effort)
      try {
        await db.run("DELETE FROM fts_learnings WHERE rowid = ?", [input.id]);
        await db.run(
          "INSERT INTO fts_learnings (rowid, title, content, context) VALUES (?, ?, ?, ?)",
          [input.id, learning.title, content, ""],
        );
      } catch { /* FTS update best-effort */ }

      if (input.durability && input.durability !== "project") {
        db.run("UPDATE learnings SET durability = ? WHERE id = ?", [input.durability, input.id]).catch(() => {});
      }

      return { id: input.id, detectedType: "learning", title: learning.title, deduplicated: false, amended: true };
    }

    throw new Error(`Record #${input.id} not found in this project`);
  }

  // Check for duplicates
  const existing = await findDuplicate(db, projectId, type, title, content);

  if (existing) {
    // Update existing record
    if (type === "decision") {
      await db.run(
        `UPDATE decisions SET decision = ?, reasoning = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [content, content, existing.id],
      );
    } else {
      await db.run(
        `UPDATE learnings SET content = ?, updated_at = datetime('now'),
         times_applied = times_applied + 1
         WHERE id = ?`,
        [content, existing.id],
      );
    }

    return {
      id: existing.id,
      detectedType: type,
      title: existing.title,
      deduplicated: true,
      existingId: existing.id,
    };
  }

  // Insert new record
  let id: number;

  if (type === "decision") {
    // Snapshot content hashes of affected files for drift detection
    const hashSnapshot = input.files
      ? await snapshotFileHashes(db, projectId, input.files)
      : null;

    const result = await db.run(
      `INSERT INTO decisions (project_id, title, decision, reasoning, alternatives, consequences, affects, content_hash_snapshot, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`,
      [
        projectId,
        title,
        content,
        content,
        input.alternatives ? JSON.stringify(input.alternatives) : null,
        input.revisit_when ?? null,
        input.files ? JSON.stringify(input.files) : null,
        hashSnapshot,
      ],
    );
    id = Number(result.lastInsertRowid ?? 0);

    // Fire-and-forget durability update
    if (input.durability && input.durability !== "project") {
      db.run("UPDATE decisions SET durability = ? WHERE id = ?", [input.durability, id]).catch(() => {});
    }

    // Update FTS
    try {
      await db.run(
        `INSERT INTO fts_decisions (rowid, title, decision, reasoning) VALUES (?, ?, ?, ?)`,
        [id, title, content, content],
      );
    } catch {
      // FTS insert might fail on duplicate
    }
  } else {
    const category = detectCategory(content);
    const result = await db.run(
      `INSERT INTO learnings (project_id, category, title, content, context, source, confidence, stage, created_at)
       VALUES (?, ?, ?, ?, ?, 'manual', 7, 'validated', datetime('now'))`,
      [projectId, category, title, content, input.files ? JSON.stringify(input.files) : null],
    );
    id = Number(result.lastInsertRowid ?? 0);

    // Fire-and-forget durability update
    if (input.durability && input.durability !== "project") {
      db.run("UPDATE learnings SET durability = ? WHERE id = ?", [input.durability, id]).catch(() => {});
    }

    // Update FTS
    try {
      await db.run(
        `INSERT INTO fts_learnings (rowid, title, content, context) VALUES (?, ?, ?, ?)`,
        [id, title, content, ""],
      );
    } catch {
      // FTS insert might fail on duplicate
    }
  }

  // Generate embedding (fire-and-forget)
  try {
    import("../database/queries/vector.js")
      .then(({ updateEmbedding }) =>
        import("../embeddings/index.js")
          .then(({ generateEmbedding }) =>
            generateEmbedding(`${title} ${content}`)
              .then((emb) => {
                if (emb) {
                  const table = type === "decision" ? "decisions" : "learnings";
                  updateEmbedding(db, table, id, emb).catch(silentCatch("remember:embedding"));
                }
              }),
          ),
      )
      .catch(silentCatch("remember:embedding-import"));
  } catch {
    // Embedding generation not critical
  }

  // Publish event for Huginn perturbation bridge
  publishEvent("muninn:events:remember", {
    type,
    title,
    id,
    projectId,
    timestamp: Date.now(),
  }).catch(() => {});

  // --- Supersede old record ---
  if (input.supersedes) {
    if (type === "decision") {
      db.run(
        "UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE id = ? AND project_id = ?",
        [id, input.supersedes, projectId],
      ).catch(() => {});
    }
    db.run(
      "UPDATE learnings SET archived_at = datetime('now'), consolidated_into = ? WHERE id = ? AND project_id = ?",
      [id, input.supersedes, projectId],
    ).catch(() => {});
    db.run(
      "INSERT INTO decision_links (decision_id, linked_decision_id, link_type, strength) VALUES (?, ?, 'supersedes', 1.0)",
      [id, input.supersedes],
    ).catch(() => {});
  }

  // --- Contradiction detection (advisory) ---
  let similarWarnings: Array<{ id: number; title: string; similarity: number }> = [];
  try {
    similarWarnings = await findSimilar(db, projectId, type, content, id);
  } catch {
    // Similarity search is advisory, never fail the write
  }

  return {
    id,
    detectedType: type,
    title,
    deduplicated: false,
    supersededId: input.supersedes,
    similarWarnings: similarWarnings.length > 0 ? similarWarnings : undefined,
  };
}

// ============================================================================
// Formatter
// ============================================================================

export function formatRememberResult(result: RememberResult): string {
  const typeLabel = result.detectedType === "decision" ? "Decision" : "Learning";

  let output: string;
  if (result.amended) {
    output = `Amended ${typeLabel} #${result.id}: ${result.title}`;
  } else if (result.deduplicated && result.existingId) {
    output = `Updated ${typeLabel} #${result.id}: ${result.title} (merged with existing #${result.existingId})`;
  } else {
    output = `Saved as ${typeLabel} #${result.id}: ${result.title}`;
  }

  if (result.supersededId) {
    output += `\nSuperseded #${result.supersededId}`;
  }

  if (result.similarWarnings && result.similarWarnings.length > 0) {
    output += "\n\nSimilar existing memories:";
    for (const w of result.similarWarnings) {
      output += `\n  #${w.id} "${w.title}" (${Math.round(w.similarity * 100)}% similar)`;
    }
    output += '\nConsider: remember({ content: "...", supersedes: ID }) to replace';
  }

  return output;
}
