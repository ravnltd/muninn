/**
 * Relationship analysis: backfill, file correlations, test file detection.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import {
  autoRelateDecisionFiles,
  autoRelateIssueFiles,
  autoRelateSessionDecisions,
  autoRelateSessionFiles,
  autoRelateSessionIssues,
  autoRelateSessionLearnings,
  getOrCreateFileId,
} from "./add.js";

// ============================================================================
// File <-> File Relationship Helpers
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
 * e.g., "src/utils/foo.test.ts" -> "src/utils/foo.ts"
 *       "src/__tests__/bar.ts" -> "src/bar.ts"
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

  console.error(`\n\u2705 Backfilled relationships:`);
  console.error(`   Decisions \u2192 Files: ${decisionCount} (${decisions.length} checked)`);
  console.error(`   Issues \u2192 Files: ${issueCount} (${issues.length} checked)`);
  console.error(`   Sessions \u2192 Files: ${sessionCount} (${sessions.length} checked)`);
  console.error(`   Sessions \u2192 Decisions: ${sessionDecisionCount}`);
  console.error(`   Sessions \u2192 Issues: ${sessionIssueCount}`);
  console.error(`   Sessions \u2192 Learnings: ${sessionLearningCount}`);
  console.error(`   File Correlations: ${fileCorrelationCount}`);
  console.error(`   Test \u2192 Source: ${testFileCount}`);
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
