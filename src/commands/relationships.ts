/**
 * Relationship commands
 * Create and query typed semantic links between entities
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

const VALID_ENTITY_TYPES = ["file", "decision", "issue", "learning", "session"] as const;
type EntityType = (typeof VALID_ENTITY_TYPES)[number];

const VALID_RELATIONSHIP_TYPES = [
  "causes", "fixes", "supersedes", "depends_on",
  "contradicts", "supports", "follows", "related",
] as const;
type RelationshipType = (typeof VALID_RELATIONSHIP_TYPES)[number];

interface RelationshipRow {
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
function parseEntityRef(ref: string): { type: EntityType; id: number } | null {
  const parts = ref.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const type = parts[0] as EntityType;
  const id = parseInt(parts[1], 10);
  if (!VALID_ENTITY_TYPES.includes(type) || isNaN(id)) {
    return null;
  }
  return { type, id };
}

/**
 * Get entity title for display
 */
function getEntityTitle(db: Database, type: EntityType, id: number): string {
  switch (type) {
    case "file": {
      const row = db.query<{ path: string }, [number]>(
        "SELECT path FROM files WHERE id = ?"
      ).get(id);
      return row?.path ?? `file:${id}`;
    }
    case "decision": {
      const row = db.query<{ title: string }, [number]>(
        "SELECT title FROM decisions WHERE id = ?"
      ).get(id);
      return row?.title ?? `decision:${id}`;
    }
    case "issue": {
      const row = db.query<{ title: string }, [number]>(
        "SELECT title FROM issues WHERE id = ?"
      ).get(id);
      return row?.title ?? `issue:${id}`;
    }
    case "learning": {
      const row = db.query<{ title: string }, [number]>(
        "SELECT title FROM learnings WHERE id = ?"
      ).get(id);
      return row?.title ?? `learning:${id}`;
    }
    case "session": {
      const row = db.query<{ goal: string | null }, [number]>(
        "SELECT goal FROM sessions WHERE id = ?"
      ).get(id);
      return row?.goal ?? `session:${id}`;
    }
  }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Create a relationship between two entities
 */
export function createRelationship(
  db: Database,
  sourceRef: string,
  relationship: string,
  targetRef: string,
  options: { strength?: number; notes?: string } = {}
): void {
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
    db.run(
      `INSERT OR REPLACE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [source.type, source.id, target.type, target.id, relationship, strength, notes]
    );

    const sourceTitle = getEntityTitle(db, source.type, source.id);
    const targetTitle = getEntityTitle(db, target.type, target.id);

    console.error(`\n✅ Relationship created:`);
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
 * Query relationships for an entity
 */
export function queryRelationships(
  db: Database,
  entityRef: string | undefined,
  options: { type?: string } = {}
): void {
  let rows: RelationshipRow[];

  if (entityRef) {
    const entity = parseEntityRef(entityRef);
    if (!entity) {
      console.error(`Invalid entity: ${entityRef}`);
      console.error("Format: <type>:<id> (e.g., file:5, decision:3)");
      process.exit(1);
    }

    rows = db.query<RelationshipRow, [string, number, string, number]>(`
      SELECT * FROM relationships
      WHERE (source_type = ? AND source_id = ?)
         OR (target_type = ? AND target_id = ?)
      ORDER BY strength DESC, created_at DESC
    `).all(entity.type, entity.id, entity.type, entity.id);
  } else if (options.type) {
    rows = db.query<RelationshipRow, [string]>(`
      SELECT * FROM relationships
      WHERE relationship = ?
      ORDER BY strength DESC, created_at DESC
    `).all(options.type);
  } else {
    rows = db.query<RelationshipRow, []>(`
      SELECT * FROM relationships
      ORDER BY strength DESC, created_at DESC
      LIMIT 50
    `).all();
  }

  if (rows.length === 0) {
    console.error("\nNo relationships found.");
    outputJson({ relationships: [] });
    return;
  }

  console.error(`\n📊 Relationships (${rows.length})\n`);

  for (const row of rows) {
    const sourceTitle = getEntityTitle(db, row.source_type as EntityType, row.source_id);
    const targetTitle = getEntityTitle(db, row.target_type as EntityType, row.target_id);
    const strengthBar = "█".repeat(Math.round(row.strength / 2)) + "░".repeat(5 - Math.round(row.strength / 2));

    console.error(`  [${strengthBar}] ${row.source_type}:${row.source_id} --[${row.relationship}]--> ${row.target_type}:${row.target_id}`);
    console.error(`           "${sourceTitle}" → "${targetTitle}"`);
    if (row.notes) {
      console.error(`           Note: ${row.notes}`);
    }
  }

  console.error("");

  outputJson({
    relationships: rows.map(r => ({
      id: r.id,
      source: { type: r.source_type, id: r.source_id },
      target: { type: r.target_type, id: r.target_id },
      relationship: r.relationship,
      strength: r.strength,
      notes: r.notes,
    })),
  });
}

/**
 * Remove a relationship by ID
 */
export function removeRelationship(db: Database, id: number): void {
  const existing = db.query<RelationshipRow, [number]>(
    "SELECT * FROM relationships WHERE id = ?"
  ).get(id);

  if (!existing) {
    console.error(`Relationship ${id} not found.`);
    process.exit(1);
  }

  db.run("DELETE FROM relationships WHERE id = ?", [id]);

  console.error(`\n✅ Removed relationship ${id}:`);
  console.error(`   ${existing.source_type}:${existing.source_id} --[${existing.relationship}]--> ${existing.target_type}:${existing.target_id}`);
  console.error("");

  outputSuccess({ deleted: id });
}

/**
 * Auto-create a "fixes" relationship when an issue is resolved
 * Called from issue resolve path
 */
export function autoRelateIssueFix(
  db: Database,
  issueId: number,
  resolutionContext?: { decisionId?: number; sessionId?: number }
): void {
  if (resolutionContext?.decisionId) {
    try {
      db.run(
        `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
         VALUES ('decision', ?, 'issue', ?, 'fixes', 8, 'Auto-detected from issue resolution')`,
        [resolutionContext.decisionId, issueId]
      );
    } catch { /* ignore duplicates */ }
  }

  if (resolutionContext?.sessionId) {
    try {
      db.run(
        `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
         VALUES ('session', ?, 'issue', ?, 'fixes', 6, 'Auto-detected: issue resolved in session')`,
        [resolutionContext.sessionId, issueId]
      );
    } catch { /* ignore duplicates */ }
  }
}

// ============================================================================
// CLI Router
// ============================================================================

export function handleRelationshipCommand(db: Database, args: string[]): void {
  const subCmd = args[0];

  switch (subCmd) {
    case "add":
    case "create": {
      // muninn relate <source> <relationship> <target> [--strength N] [--notes "..."]
      const source = args[1];
      const relationship = args[2];
      const target = args[3];

      if (!source || !relationship || !target) {
        console.error("Usage: muninn relate <source> <relationship> <target> [--strength N] [--notes \"...\"]");
        console.error("Example: muninn relate decision:5 fixes issue:3 --strength 8");
        process.exit(1);
      }

      const strengthIdx = args.indexOf("--strength");
      const strength = strengthIdx !== -1 ? parseInt(args[strengthIdx + 1], 10) : undefined;
      const notesIdx = args.indexOf("--notes");
      const notes = notesIdx !== -1 ? args.slice(notesIdx + 1).join(" ") : undefined;

      createRelationship(db, source, relationship, target, { strength, notes });
      break;
    }

    case "list":
    case "query": {
      // muninn relations [entity] [--type <type>]
      const entity = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      const typeIdx = args.indexOf("--type");
      const type = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
      queryRelationships(db, entity, { type });
      break;
    }

    case "remove":
    case "delete": {
      const id = parseInt(args[1], 10);
      if (isNaN(id)) {
        console.error("Usage: muninn unrelate <id>");
        process.exit(1);
      }
      removeRelationship(db, id);
      break;
    }

    default:
      console.error(`Usage: muninn relate <source> <relationship> <target>
       muninn relations [entity] [--type <type>]
       context unrelate <id>

Relationship types: ${VALID_RELATIONSHIP_TYPES.join(", ")}
Entity format: <type>:<id> (e.g., file:5, decision:3)
Entity types: ${VALID_ENTITY_TYPES.join(", ")}

Examples:
  muninn relate decision:5 fixes issue:3 --strength 8
  muninn relate file:10 depends_on file:2
  muninn relations decision:5
  muninn relations --type fixes
  context unrelate 7`);
  }
}
