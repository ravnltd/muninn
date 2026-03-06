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
import { silentCatch } from "../utils/silent-catch.js";

// ============================================================================
// Types
// ============================================================================

type RememberType = "decision" | "learning";

interface RememberInput {
  content: string;
  type?: RememberType;
  files?: string[];
}

interface RememberResult {
  id: number;
  detectedType: RememberType;
  title: string;
  deduplicated: boolean;
  existingId?: number;
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
    const result = await db.run(
      `INSERT INTO decisions (project_id, title, decision, reasoning, affects, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))`,
      [projectId, title, content, content, input.files ? JSON.stringify(input.files) : null],
    );
    id = Number(result.lastInsertRowid ?? 0);

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
      `INSERT INTO learnings (project_id, category, title, content, context, source, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, 'manual', 7, datetime('now'))`,
      [projectId, category, title, content, input.files ? JSON.stringify(input.files) : null],
    );
    id = Number(result.lastInsertRowid ?? 0);

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

  return {
    id,
    detectedType: type,
    title,
    deduplicated: false,
  };
}

// ============================================================================
// Formatter
// ============================================================================

export function formatRememberResult(result: RememberResult): string {
  const action = result.deduplicated ? "Updated" : "Saved";
  const typeLabel = result.detectedType === "decision" ? "Decision" : "Learning";

  let output = `${action} as ${typeLabel} #${result.id}: ${result.title}`;

  if (result.deduplicated && result.existingId) {
    output += ` (merged with existing #${result.existingId})`;
  }

  return output;
}
