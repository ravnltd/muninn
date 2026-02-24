/**
 * Relationship commands
 * Create and query typed semantic links between entities
 */

import type { DatabaseAdapter } from "../../database/adapter.js";

// Re-export everything from sub-modules
export {
  VALID_ENTITY_TYPES,
  VALID_RELATIONSHIP_TYPES,
  type EntityType,
  type RelationshipType,
  type RelationshipRow,
  parseEntityRef,
  getEntityTitle,
  getOrCreateFileId,
  createRelationship,
  removeRelationship,
  autoRelateIssueFiles,
  autoRelateLearningFiles,
  autoRelateSessionFiles,
  autoRelateIssueFix,
  autoRelateSessionDecisions,
  autoRelateSessionIssues,
  autoRelateSessionLearnings,
  autoRelateDecisionFiles,
} from "./add.js";

export { queryRelationships } from "./list.js";

export {
  autoRelateFileCorrelations,
  autoRelateTestFiles,
  backfillEntityRelationships,
} from "./analysis.js";

// ============================================================================
// CLI Router
// ============================================================================

export async function handleRelationshipCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const { createRelationship } = await import("./add.js");
  const { queryRelationships } = await import("./list.js");
  const { backfillEntityRelationships } = await import("./analysis.js");
  const { removeRelationship, VALID_RELATIONSHIP_TYPES, VALID_ENTITY_TYPES } = await import("./add.js");

  const subCmd = args[0];

  switch (subCmd) {
    case "add":
    case "create": {
      // muninn relate <source> <relationship> <target> [--strength N] [--notes "..."]
      const source = args[1];
      const relationship = args[2];
      const target = args[3];

      if (!source || !relationship || !target) {
        console.error('Usage: muninn relate <source> <relationship> <target> [--strength N] [--notes "..."]');
        console.error("Example: muninn relate decision:5 fixes issue:3 --strength 8");
        process.exit(1);
      }

      const strengthIdx = args.indexOf("--strength");
      const strength = strengthIdx !== -1 ? parseInt(args[strengthIdx + 1], 10) : undefined;
      const notesIdx = args.indexOf("--notes");
      const notes = notesIdx !== -1 ? args.slice(notesIdx + 1).join(" ") : undefined;

      await createRelationship(db, source, relationship, target, { strength, notes });
      break;
    }

    case "list":
    case "query": {
      // Check for backfill subcommand first
      if (args[1] === "backfill") {
        await backfillEntityRelationships(db, projectId);
        break;
      }
      // muninn relations [entity] [--type <type>]
      const entity = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      const typeIdx = args.indexOf("--type");
      const type = typeIdx !== -1 ? args[typeIdx + 1] : undefined;
      await queryRelationships(db, entity, { type });
      break;
    }

    case "remove":
    case "delete": {
      const id = parseInt(args[1], 10);
      if (Number.isNaN(id)) {
        console.error("Usage: muninn unrelate <id>");
        process.exit(1);
      }
      await removeRelationship(db, id);
      break;
    }

    case "backfill": {
      await backfillEntityRelationships(db, projectId);
      break;
    }

    default:
      console.error(`Usage: muninn relate <source> <relationship> <target>
       muninn relations [entity] [--type <type>]
       muninn relations backfill
       context unrelate <id>

Relationship types: ${VALID_RELATIONSHIP_TYPES.join(", ")}
Entity format: <type>:<id> (e.g., file:5, decision:3)
Entity types: ${VALID_ENTITY_TYPES.join(", ")}

Examples:
  muninn relate decision:5 fixes issue:3 --strength 8
  muninn relate file:10 depends_on file:2
  muninn relations decision:5
  muninn relations --type fixes
  muninn relations backfill
  context unrelate 7`);
  }
}
