/**
 * FTS repair utilities.
 *
 * Fixes fts_issues if it was created with wrong columns (missing workaround/resolution).
 * FTS virtual tables cannot be ALTERed — must drop and recreate.
 */

import type { DatabaseAdapter } from "../adapter.js";

export async function repairFtsIssues(adapter: DatabaseAdapter): Promise<void> {
  try {
    await adapter.get("SELECT workaround FROM fts_issues LIMIT 1");
  } catch {
    // Column missing — drop, recreate with correct schema, and repopulate
    await adapter.exec(`
      DROP TABLE IF EXISTS fts_issues;
      CREATE VIRTUAL TABLE fts_issues USING fts5(title, description, workaround, resolution);
      INSERT INTO fts_issues(rowid, title, description, workaround, resolution)
        SELECT id, title, COALESCE(description, ''), COALESCE(workaround, ''), COALESCE(resolution, '')
        FROM issues;
      DROP TRIGGER IF EXISTS issues_ai;
      CREATE TRIGGER issues_ai AFTER INSERT ON issues BEGIN
        INSERT INTO fts_issues(rowid, title, description, workaround, resolution)
        VALUES (NEW.id, NEW.title, NEW.description, NEW.workaround, NEW.resolution);
      END;
    `);
  }
}
