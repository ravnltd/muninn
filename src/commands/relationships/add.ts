/**
 * Relationship creation, removal, and auto-relate helpers.
 * Core types and entity helpers shared across the module.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import { outputSuccess } from "../../utils/format.js";

// ============================================================================
// Types
// ============================================================================

export const VALID_ENTITY_TYPES = ["file", "decision", "issue", "learning", "session"] as const;
export type EntityType = (typeof VALID_ENTITY_TYPES)[number];

export const VALID_RELATIONSHIP_TYPES = [
  "causes",
  "fixes",
  "supersedes",
  "depends_on",
  "contradicts",
  "supports",
  "follows",
  "related",
  // Session -> entity relationships
  "made", // session -> decision
  "found", // session -> issue
  "resolved", // session -> issue
  "learned", // session -> learning
  // File <-> file relationships
  "often_changes_with", // file <-> file (co-change pattern)
  "tests", // file <-> file (test -> source)
] as const;
export type RelationshipType = (typeof VALID_RELATIONSHIP_TYPES)[number];

export interface RelationshipRow {
  id: number;
  source_type: string;
  source_id: number;
  target_type: string;
  target_id: number;
  relationship: string;
  strength: number;
  notes: string | null;
  created_at: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse entity reference like "file:5" or "decision:3"
 */
export function parseEntityRef(ref: string): { type: EntityType; id: number } | null {
  const parts = ref.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const type = parts[0] as EntityType;
  const id = parseInt(parts[1], 10);
  if (!VALID_ENTITY_TYPES.includes(type) || Number.isNaN(id)) {
    return null;
  }
  return { type, id };
}

/**
 * Get entity title for display
 */
export async function getEntityTitle(db: DatabaseAdapter, type: EntityType, id: number): Promise<string> {
  switch (type) {
    case "file": {
      const row = await db.get<{ path: string }>("SELECT path FROM files WHERE id = ?", [id]);
      return row?.path ?? `file:${id}`;
    }
    case "decision": {
      const row = await db.get<{ title: string }>("SELECT title FROM decisions WHERE id = ?", [id]);
      return row?.title ?? `decision:${id}`;
    }
    case "issue": {
      const row = await db.get<{ title: string }>("SELECT title FROM issues WHERE id = ?", [id]);
      return row?.title ?? `issue:${id}`;
    }
    case "learning": {
      const row = await db.get<{ title: string }>("SELECT title FROM learnings WHERE id = ?", [id]);
      return row?.title ?? `learning:${id}`;
    }
    case "session": {
      const row = await db.get<{ goal: string | null }>("SELECT goal FROM sessions WHERE id = ?", [id]);
      return row?.goal ?? `session:${id}`;
    }
  }
}

/**
 * Get or create a file record by path, returning its ID
 */
export async function getOrCreateFileId(db: DatabaseAdapter, projectId: number, filePath: string): Promise<number | null> {
  // Try to find existing file
  const existing = await db.get<{ id: number }>("SELECT id FROM files WHERE project_id = ? AND path = ?", [projectId, filePath]);

  if (existing) {
    return existing.id;
  }

  // Create minimal file record
  try {
    const result = await db.run(
      `INSERT OR IGNORE INTO files (project_id, path, purpose, fragility)
       VALUES (?, ?, 'Auto-created from entity relationship', 1)`,
      [projectId, filePath]
    );
    if (result.lastInsertRowid) {
      return Number(result.lastInsertRowid);
    }
    // If insert was ignored (race condition), fetch existing
    const created = await db.get<{ id: number }>("SELECT id FROM files WHERE project_id = ? AND path = ?", [projectId, filePath]);
    return created?.id || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Create a relationship between two entities
 */
export async function createRelationship(
  db: DatabaseAdapter,
  sourceRef: string,
  relationship: string,
  targetRef: string,
  options: { strength?: number; notes?: string } = {}
): Promise<void> {
  const source = parseEntityRef(sourceRef);
  if (!source) {
    console.error(`Invalid source entity: ${sourceRef}`);
    console.error("Format: <type>:<id> (e.g., file:5, decision:3)");
    console.error(`Valid types: ${VALID_ENTITY_TYPES.join(", ")}`);
    process.exit(1);
  }

  const target = parseEntityRef(targetRef);
  if (!target) {
    console.error(`Invalid target entity: ${targetRef}`);
    console.error("Format: <type>:<id> (e.g., file:5, decision:3)");
    process.exit(1);
  }

  if (!VALID_RELATIONSHIP_TYPES.includes(relationship as RelationshipType)) {
    console.error(`Invalid relationship type: ${relationship}`);
    console.error(`Valid types: ${VALID_RELATIONSHIP_TYPES.join(", ")}`);
    process.exit(1);
  }

  const strength = options.strength ?? 5;
  const notes = options.notes ?? null;

  try {
    await db.run(
      `INSERT OR REPLACE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [source.type, source.id, target.type, target.id, relationship, strength, notes]
    );

    const sourceTitle = await getEntityTitle(db, source.type, source.id);
    const targetTitle = await getEntityTitle(db, target.type, target.id);

    console.error(`\n\u2705 Relationship created:`);
    console.error(`   ${source.type}:${source.id} (${sourceTitle})`);
    console.error(`   --[${relationship}]-->`);
    console.error(`   ${target.type}:${target.id} (${targetTitle})`);
    if (strength !== 5) {
      console.error(`   Strength: ${strength}/10`);
    }
    console.error("");

    outputSuccess({
      source: { type: source.type, id: source.id },
      target: { type: target.type, id: target.id },
      relationship,
      strength,
    });
  } catch (error) {
    console.error(`Failed to create relationship: ${error}`);
    process.exit(1);
  }
}

/**
 * Remove a relationship by ID
 */
export async function removeRelationship(db: DatabaseAdapter, id: number): Promise<void> {
  const existing = await db.get<RelationshipRow>("SELECT * FROM relationships WHERE id = ?", [id]);

  if (!existing) {
    console.error(`Relationship ${id} not found.`);
    process.exit(1);
  }

  await db.run("DELETE FROM relationships WHERE id = ?", [id]);

  console.error(`\n\u2705 Removed relationship ${id}:`);
  console.error(
    `   ${existing.source_type}:${existing.source_id} --[${existing.relationship}]--> ${existing.target_type}:${existing.target_id}`
  );
  console.error("");

  outputSuccess({ deleted: id });
}

// ============================================================================
// Auto-Relate Helpers
// ============================================================================

/**
 * Auto-create relationships between an issue and its affected files
 */
export async function autoRelateIssueFiles(db: DatabaseAdapter, projectId: number, issueId: number, files: string[]): Promise<void> {
  for (const filePath of files) {
    const fileId = await getOrCreateFileId(db, projectId, filePath);
    if (fileId) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
           VALUES ('issue', ?, 'file', ?, 'related', 7, 'Auto-created: issue affects this file')`,
          [issueId, fileId]
        );
      } catch {
        /* ignore duplicates */
      }
    }
  }
}

/**
 * Auto-create relationships between a learning and related files
 */
export async function autoRelateLearningFiles(db: DatabaseAdapter, projectId: number, learningId: number, files: string[]): Promise<void> {
  for (const filePath of files) {
    const fileId = await getOrCreateFileId(db, projectId, filePath);
    if (fileId) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
           VALUES ('learning', ?, 'file', ?, 'related', 6, 'Auto-created: learning applies to this file')`,
          [learningId, fileId]
        );
      } catch {
        /* ignore duplicates */
      }
    }
  }
}

/**
 * Auto-create relationships between a session and files it touched
 */
export async function autoRelateSessionFiles(db: DatabaseAdapter, projectId: number, sessionId: number, files: string[]): Promise<void> {
  for (const filePath of files) {
    const fileId = await getOrCreateFileId(db, projectId, filePath);
    if (fileId) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
           VALUES ('session', ?, 'file', ?, 'related', 5, 'Auto-created: file touched during session')`,
          [sessionId, fileId]
        );
      } catch {
        /* ignore duplicates */
      }
    }
  }
}

/**
 * Auto-create a "fixes" relationship when an issue is resolved
 * Called from issue resolve path
 */
export async function autoRelateIssueFix(
  db: DatabaseAdapter,
  issueId: number,
  resolutionContext?: { decisionId?: number; sessionId?: number }
): Promise<void> {
  if (resolutionContext?.decisionId) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
         VALUES ('decision', ?, 'issue', ?, 'fixes', 8, 'Auto-detected from issue resolution')`,
        [resolutionContext.decisionId, issueId]
      );
    } catch {
      /* ignore duplicates */
    }
  }

  if (resolutionContext?.sessionId) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
         VALUES ('session', ?, 'issue', ?, 'fixes', 6, 'Auto-detected: issue resolved in session')`,
        [resolutionContext.sessionId, issueId]
      );
    } catch {
      /* ignore duplicates */
    }
  }
}

// ============================================================================
// Session -> Entity Relationship Helpers
// ============================================================================

/**
 * Auto-create "made" relationships between a session and decisions made during it
 * Strength: 7 (session made this decision)
 */
export async function autoRelateSessionDecisions(db: DatabaseAdapter, sessionId: number, decisionIds: number[]): Promise<void> {
  for (const decisionId of decisionIds) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
         VALUES ('session', ?, 'decision', ?, 'made', 7, 'Auto-created: decision made during session')`,
        [sessionId, decisionId]
      );
    } catch {
      /* ignore duplicates */
    }
  }
}

/**
 * Auto-create "found" or "resolved" relationships between a session and issues
 * Strength: 8 for resolved, 6 for found
 */
export async function autoRelateSessionIssues(
  db: DatabaseAdapter,
  sessionId: number,
  issueIds: number[],
  relation: "found" | "resolved"
): Promise<void> {
  const strength = relation === "resolved" ? 8 : 6;
  const note =
    relation === "resolved"
      ? "Auto-created: issue resolved during session"
      : "Auto-created: issue discovered during session";

  for (const issueId of issueIds) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
         VALUES ('session', ?, 'issue', ?, ?, ?, ?)`,
        [sessionId, issueId, relation, strength, note]
      );
    } catch {
      /* ignore duplicates */
    }
  }
}

/**
 * Auto-create "learned" relationships between a session and learnings extracted from it
 * Queries session_learnings table to find learnings linked to this session
 * Strength: 7
 */
export async function autoRelateSessionLearnings(db: DatabaseAdapter, sessionId: number): Promise<void> {
  try {
    const learnings = await db.all<{ learning_id: number }>(`
      SELECT learning_id FROM session_learnings
      WHERE session_id = ? AND learning_id IS NOT NULL
    `, [sessionId]);

    for (const { learning_id } of learnings) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
           VALUES ('session', ?, 'learning', ?, 'learned', 7, 'Auto-created: learning extracted from session')`,
          [sessionId, learning_id]
        );
      } catch {
        /* ignore duplicates */
      }
    }
  } catch {
    // session_learnings table might not exist
  }
}

/**
 * Auto-create relationships between a decision and its affected files
 */
export async function autoRelateDecisionFiles(db: DatabaseAdapter, projectId: number, decisionId: number, files: string[]): Promise<void> {
  for (const filePath of files) {
    const fileId = await getOrCreateFileId(db, projectId, filePath);
    if (fileId) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
           VALUES ('decision', ?, 'file', ?, 'related', 8, 'Auto-created: decision affects this file')`,
          [decisionId, fileId]
        );
      } catch {
        /* ignore duplicates */
      }
    }
  }
}
