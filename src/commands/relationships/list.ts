/**
 * Relationship querying and display.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import { outputJson } from "../../utils/format.js";
import type { EntityType, RelationshipRow } from "./add.js";
import { getEntityTitle, parseEntityRef } from "./add.js";

/**
 * Query relationships for an entity
 */
export async function queryRelationships(db: DatabaseAdapter, entityRef: string | undefined, options: { type?: string } = {}): Promise<void> {
  let rows: RelationshipRow[];

  if (entityRef) {
    const entity = parseEntityRef(entityRef);
    if (!entity) {
      console.error(`Invalid entity: ${entityRef}`);
      console.error("Format: <type>:<id> (e.g., file:5, decision:3)");
      process.exit(1);
    }

    rows = await db.all<RelationshipRow>(`
      SELECT * FROM relationships
      WHERE (source_type = ? AND source_id = ?)
         OR (target_type = ? AND target_id = ?)
      ORDER BY strength DESC, created_at DESC
    `, [entity.type, entity.id, entity.type, entity.id]);
  } else if (options.type) {
    rows = await db.all<RelationshipRow>(`
      SELECT * FROM relationships
      WHERE relationship = ?
      ORDER BY strength DESC, created_at DESC
    `, [options.type]);
  } else {
    rows = await db.all<RelationshipRow>(`
      SELECT * FROM relationships
      ORDER BY strength DESC, created_at DESC
      LIMIT 50
    `, []);
  }

  if (rows.length === 0) {
    console.error("\nNo relationships found.");
    outputJson({ relationships: [] });
    return;
  }

  console.error(`\n\u{1F4CA} Relationships (${rows.length})\n`);

  for (const row of rows) {
    const sourceTitle = await getEntityTitle(db, row.source_type as EntityType, row.source_id);
    const targetTitle = await getEntityTitle(db, row.target_type as EntityType, row.target_id);
    const strengthBar = "\u2588".repeat(Math.round(row.strength / 2)) + "\u2591".repeat(5 - Math.round(row.strength / 2));

    console.error(
      `  [${strengthBar}] ${row.source_type}:${row.source_id} --[${row.relationship}]--> ${row.target_type}:${row.target_id}`
    );
    console.error(`           "${sourceTitle}" \u2192 "${targetTitle}"`);
    if (row.notes) {
      console.error(`           Note: ${row.notes}`);
    }
  }

  console.error("");

  outputJson({
    relationships: rows.map((r) => ({
      id: r.id,
      source: { type: r.source_type, id: r.source_id },
      target: { type: r.target_type, id: r.target_id },
      relationship: r.relationship,
      strength: r.strength,
      notes: r.notes,
    })),
  });
}
