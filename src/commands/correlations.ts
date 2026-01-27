/**
 * File Correlation Tracking
 * Track which files change together to predict co-changes
 */

import type { DatabaseAdapter } from "../database/adapter";
import { outputJson } from "../utils/format";

export interface FileCorrelation {
  file: string;
  cochange_count: number;
  correlation_strength: number;
  last_cochange: string;
}

/**
 * Update file correlations based on files changed together
 */
export async function updateFileCorrelations(db: DatabaseAdapter, projectId: number, files: string[]): Promise<void> {
  if (files.length < 2) return;

  // Sort files to ensure consistent ordering (file_a < file_b alphabetically)
  const sortedFiles = [...files].sort();

  // Create all pairs
  for (let i = 0; i < sortedFiles.length; i++) {
    for (let j = i + 1; j < sortedFiles.length; j++) {
      const fileA = sortedFiles[i];
      const fileB = sortedFiles[j];

      try {
        // Upsert correlation
        await db.run(
          `INSERT INTO file_correlations (project_id, file_a, file_b, cochange_count, last_cochange)
           VALUES (?, ?, ?, 1, datetime('now'))
           ON CONFLICT(project_id, file_a, file_b) DO UPDATE SET
             cochange_count = cochange_count + 1,
             last_cochange = datetime('now'),
             correlation_strength = CAST(cochange_count + 1 AS REAL) /
               (1 + (julianday('now') - julianday(created_at)))`,
          [projectId, fileA, fileB]
        );
      } catch {
        // Table might not exist in older databases, skip silently
      }
    }
  }
}

/**
 * Get files that often change together with a given file
 */
export async function getCorrelatedFiles(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string,
  limit: number = 5
): Promise<FileCorrelation[]> {
  try {
    // Check both directions (file could be file_a or file_b)
    const correlations = await db.all<{
      file: string;
      cochange_count: number;
      correlation_strength: number;
      last_cochange: string;
    }>(
      `SELECT
         CASE WHEN file_a = ? THEN file_b ELSE file_a END as file,
         cochange_count,
         COALESCE(correlation_strength, CAST(cochange_count AS REAL) / 10) as correlation_strength,
         last_cochange
       FROM file_correlations
       WHERE project_id = ? AND (file_a = ? OR file_b = ?)
       ORDER BY cochange_count DESC, last_cochange DESC
       LIMIT ?`,
      [filePath, projectId, filePath, filePath, limit]
    );

    return correlations;
  } catch {
    return []; // Table might not exist
  }
}

/**
 * Get top file correlations across the project
 */
export async function getTopCorrelations(
  db: DatabaseAdapter,
  projectId: number,
  limit: number = 10
): Promise<Array<{
  file_a: string;
  file_b: string;
  cochange_count: number;
  correlation_strength: number;
}>> {
  try {
    return await db.all<{
      file_a: string;
      file_b: string;
      cochange_count: number;
      correlation_strength: number;
    }>(
      `SELECT file_a, file_b, cochange_count,
         COALESCE(correlation_strength, CAST(cochange_count AS REAL) / 10) as correlation_strength
       FROM file_correlations
       WHERE project_id = ? AND cochange_count > 1
       ORDER BY cochange_count DESC
       LIMIT ?`,
      [projectId, limit]
    );
  } catch {
    return []; // Table might not exist
  }
}

/**
 * Handle correlation subcommands
 */
export async function handleCorrelationCommand(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const file = args[0];

  if (file) {
    const correlated = await getCorrelatedFiles(db, projectId, file);
    if (correlated.length === 0) {
      console.error(`No correlations found for ${file}`);
      console.error("Correlations are built as you complete sessions.");
    } else {
      console.error(`\n🔗 Files that often change with ${file}:\n`);
      for (const c of correlated) {
        const strength = Math.round(c.correlation_strength * 100);
        console.error(`   ${c.file} (${c.cochange_count}x, ${strength}% strength)`);
      }
    }
    outputJson(correlated);
  } else {
    const top = await getTopCorrelations(db, projectId);
    if (top.length === 0) {
      console.error("No file correlations recorded yet.");
      console.error("Correlations are built as you complete sessions.");
    } else {
      console.error("\n🔗 Top File Correlations:\n");
      for (const c of top) {
        console.error(`   ${c.file_a} ↔ ${c.file_b} (${c.cochange_count}x)`);
      }
    }
    outputJson(top);
  }
}
