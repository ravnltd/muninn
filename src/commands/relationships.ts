/**
 * Relationship commands
 * Create and query typed semantic links between entities
 */

import type { DatabaseAdapter } from "../database/adapter";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

const VALID_ENTITY_TYPES = ["file", "decision", "issue", "learning", "session"] as const;
type EntityType = (typeof VALID_ENTITY_TYPES)[number];

const VALID_RELATIONSHIP_TYPES = [
  "causes",
  "fixes",
  "supersedes",
  "depends_on",
  "contradicts",
  "supports",
  "follows",
  "related",
  // Session → entity relationships
  "made", // session → decision
  "found", // session → issue
  "resolved", // session → issue
  "learned", // session → learning
  // File ↔ file relationships
  "often_changes_with", // file ↔ file (co-change pattern)
  "tests", // file ↔ file (test → source)
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
  if (!VALID_ENTITY_TYPES.includes(type) || Number.isNaN(id)) {
    return null;
  }
  return { type, id };
}

/**
 * Get entity title for display
 */
async function getEntityTitle(db: DatabaseAdapter, type: EntityType, id: number): Promise<string> {
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

  console.error(`\n📊 Relationships (${rows.length})\n`);

  for (const row of rows) {
    const sourceTitle = await getEntityTitle(db, row.source_type as EntityType, row.source_id);
    const targetTitle = await getEntityTitle(db, row.target_type as EntityType, row.target_id);
    const strengthBar = "█".repeat(Math.round(row.strength / 2)) + "░".repeat(5 - Math.round(row.strength / 2));

    console.error(
      `  [${strengthBar}] ${row.source_type}:${row.source_id} --[${row.relationship}]--> ${row.target_type}:${row.target_id}`
    );
    console.error(`           "${sourceTitle}" → "${targetTitle}"`);
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

  console.error(`\n✅ Removed relationship ${id}:`);
  console.error(
    `   ${existing.source_type}:${existing.source_id} --[${existing.relationship}]--> ${existing.target_type}:${existing.target_id}`
  );
  console.error("");

  outputSuccess({ deleted: id });
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
// Session → Entity Relationship Helpers
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

// ============================================================================
// File ↔ File Relationship Helpers
// ============================================================================

/**
 * Auto-create "often_changes_with" relationships based on file correlations
 * Strength: min(10, cochange_count) - more co-changes = stronger relationship
 */
export async function autoRelateFileCorrelations(db: DatabaseAdapter, projectId: number, minCount: number = 3): Promise<number> {
  let count = 0;
  try {
    const correlations = await db.all<{
      file_a: string;
      file_b: string;
      cochange_count: number;
    }>(`
      SELECT file_a, file_b, cochange_count FROM file_correlations
      WHERE project_id = ? AND cochange_count >= ?
    `, [projectId, minCount]);

    for (const { file_a, file_b, cochange_count } of correlations) {
      const fileAId = await getOrCreateFileId(db, projectId, file_a);
      const fileBId = await getOrCreateFileId(db, projectId, file_b);

      if (fileAId && fileBId) {
        const strength = Math.min(10, cochange_count);
        try {
          await db.run(
            `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
             VALUES ('file', ?, 'file', ?, 'often_changes_with', ?, ?)`,
            [fileAId, fileBId, strength, `Co-changed ${cochange_count} times`]
          );
          count++;
        } catch {
          /* ignore duplicates */
        }
      }
    }
  } catch {
    // file_correlations table might not exist
  }
  return count;
}

/**
 * Auto-create "tests" relationships between test files and their source files
 * Detects patterns: *.test.ts, *.spec.ts, __tests__/*.ts
 * Strength: 9 (strong relationship)
 */
export async function autoRelateTestFiles(db: DatabaseAdapter, projectId: number): Promise<number> {
  let count = 0;
  try {
    // Get all test files
    const testFiles = await db.all<{ id: number; path: string }>(`
      SELECT id, path FROM files
      WHERE project_id = ?
      AND (path LIKE '%.test.%' OR path LIKE '%.spec.%' OR path LIKE '%__tests__%')
    `, [projectId]);

    for (const testFile of testFiles) {
      const sourcePath = inferSourceFromTestPath(testFile.path);
      if (!sourcePath) continue;

      // Find the source file
      const sourceFile = await db.get<{ id: number }>("SELECT id FROM files WHERE project_id = ? AND path = ?", [projectId, sourcePath]);

      if (sourceFile) {
        try {
          await db.run(
            `INSERT OR IGNORE INTO relationships (source_type, source_id, target_type, target_id, relationship, strength, notes)
             VALUES ('file', ?, 'file', ?, 'tests', 9, 'Auto-detected: test file for source')`,
            [testFile.id, sourceFile.id]
          );
          count++;
        } catch {
          /* ignore duplicates */
        }
      }
    }
  } catch {
    // files table might not have expected columns
  }
  return count;
}

/**
 * Infer the source file path from a test file path
 * e.g., "src/utils/foo.test.ts" → "src/utils/foo.ts"
 *       "src/__tests__/bar.ts" → "src/bar.ts"
 */
function inferSourceFromTestPath(testPath: string): string | null {
  // Handle *.test.* and *.spec.* patterns
  const testMatch = testPath.match(/^(.+)\.(test|spec)\.([^.]+)$/);
  if (testMatch) {
    return `${testMatch[1]}.${testMatch[3]}`;
  }

  // Handle __tests__ directory pattern
  const testsMatch = testPath.match(/^(.+)\/__tests__\/(.+)$/);
  if (testsMatch) {
    return `${testsMatch[1]}/${testsMatch[2]}`;
  }

  return null;
}

// ============================================================================
// Backfill Existing Entities
// ============================================================================

interface IssueRow {
  id: number;
  affected_files: string | null;
}

interface SessionRow {
  id: number;
  files_touched: string | null;
}

interface DecisionRow {
  id: number;
  affects: string | null;
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

interface ExtendedSessionRow extends SessionRow {
  decisions_made: string | null;
  issues_found: string | null;
  issues_resolved: string | null;
}

/**
 * Backfill relationships for existing issues, sessions, and decisions
 */
export async function backfillEntityRelationships(
  db: DatabaseAdapter,
  projectId: number
): Promise<{
  decisions: number;
  issues: number;
  sessions: number;
  sessionDecisions: number;
  sessionIssues: number;
  sessionLearnings: number;
  fileCorrelations: number;
  testFiles: number;
}> {
  let decisionCount = 0;
  let issueCount = 0;
  let sessionCount = 0;
  let sessionDecisionCount = 0;
  let sessionIssueCount = 0;
  let sessionLearningCount = 0;

  // Backfill decisions with affects
  const decisions = await db.all<DecisionRow>(`
    SELECT id, affects FROM decisions
    WHERE project_id = ? AND affects IS NOT NULL
  `, [projectId]);

  for (const decision of decisions) {
    if (!decision.affects) continue;
    try {
      const files = JSON.parse(decision.affects) as string[];
      if (Array.isArray(files) && files.length > 0) {
        await autoRelateDecisionFiles(db, projectId, decision.id, files);
        decisionCount++;
      }
    } catch {
      /* invalid JSON - might be plain text like "all services" */
    }
  }

  // Backfill issues with affected_files
  const issues = await db.all<IssueRow>(`
    SELECT id, affected_files FROM issues
    WHERE project_id = ? AND affected_files IS NOT NULL
  `, [projectId]);

  for (const issue of issues) {
    if (!issue.affected_files) continue;
    try {
      const files = JSON.parse(issue.affected_files) as string[];
      if (Array.isArray(files) && files.length > 0) {
        await autoRelateIssueFiles(db, projectId, issue.id, files);
        issueCount++;
      }
    } catch {
      /* invalid JSON */
    }
  }

  // Backfill sessions with files_touched AND new relationship types
  const sessions = await db.all<ExtendedSessionRow>(`
    SELECT id, files_touched, decisions_made, issues_found, issues_resolved FROM sessions
    WHERE project_id = ?
  `, [projectId]);

  for (const session of sessions) {
    // Files touched (existing)
    if (session.files_touched) {
      try {
        const files = JSON.parse(session.files_touched) as string[];
        if (Array.isArray(files) && files.length > 0) {
          await autoRelateSessionFiles(db, projectId, session.id, files);
          sessionCount++;
        }
      } catch {
        /* invalid JSON */
      }
    }

    // Decisions made (new)
    if (session.decisions_made) {
      try {
        const decisionIds = JSON.parse(session.decisions_made) as number[];
        if (Array.isArray(decisionIds) && decisionIds.length > 0) {
          await autoRelateSessionDecisions(db, session.id, decisionIds);
          sessionDecisionCount += decisionIds.length;
        }
      } catch {
        /* invalid JSON */
      }
    }

    // Issues found (new)
    if (session.issues_found) {
      try {
        const issueIds = JSON.parse(session.issues_found) as number[];
        if (Array.isArray(issueIds) && issueIds.length > 0) {
          await autoRelateSessionIssues(db, session.id, issueIds, "found");
          sessionIssueCount += issueIds.length;
        }
      } catch {
        /* invalid JSON */
      }
    }

    // Issues resolved (new)
    if (session.issues_resolved) {
      try {
        const issueIds = JSON.parse(session.issues_resolved) as number[];
        if (Array.isArray(issueIds) && issueIds.length > 0) {
          await autoRelateSessionIssues(db, session.id, issueIds, "resolved");
          sessionIssueCount += issueIds.length;
        }
      } catch {
        /* invalid JSON */
      }
    }

    // Learnings (new) - via session_learnings table
    await autoRelateSessionLearnings(db, session.id);
    // Count is hard to track here, we'll estimate
  }

  // Count session learnings separately
  try {
    const learningCount = await db.get<{ count: number }>(`
      SELECT COUNT(*) as count FROM session_learnings sl
      JOIN sessions s ON sl.session_id = s.id
      WHERE s.project_id = ? AND sl.learning_id IS NOT NULL
    `, [projectId]);
    sessionLearningCount = learningCount?.count || 0;
  } catch {
    // Table might not exist
  }

  // File correlations (new)
  const fileCorrelationCount = await autoRelateFileCorrelations(db, projectId, 3);

  // Test file relationships (new)
  const testFileCount = await autoRelateTestFiles(db, projectId);

  console.error(`\n✅ Backfilled relationships:`);
  console.error(`   Decisions → Files: ${decisionCount} (${decisions.length} checked)`);
  console.error(`   Issues → Files: ${issueCount} (${issues.length} checked)`);
  console.error(`   Sessions → Files: ${sessionCount} (${sessions.length} checked)`);
  console.error(`   Sessions → Decisions: ${sessionDecisionCount}`);
  console.error(`   Sessions → Issues: ${sessionIssueCount}`);
  console.error(`   Sessions → Learnings: ${sessionLearningCount}`);
  console.error(`   File Correlations: ${fileCorrelationCount}`);
  console.error(`   Test → Source: ${testFileCount}`);
  console.error(`\nNote: Duplicate relationships are automatically ignored.`);
  console.error("");

  return {
    decisions: decisionCount,
    issues: issueCount,
    sessions: sessionCount,
    sessionDecisions: sessionDecisionCount,
    sessionIssues: sessionIssueCount,
    sessionLearnings: sessionLearningCount,
    fileCorrelations: fileCorrelationCount,
    testFiles: testFileCount,
  };
}

// ============================================================================
// CLI Router
// ============================================================================

export async function handleRelationshipCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
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
