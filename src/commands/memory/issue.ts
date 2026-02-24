/**
 * Issue commands
 * Add, resolve, and list issues.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import {
  generateEmbedding,
  isEmbeddingAvailable,
  issueToText,
  serializeEmbedding,
} from "../../embeddings";
import { exitWithUsage, logError, safeJsonParse } from "../../utils/errors.js";
import { outputJson, outputSuccess } from "../../utils/format.js";
import { parseIssueArgs } from "../../utils/validation.js";
import { autoRelateIssueFiles } from "../relationships/add.js";

export async function issueAdd(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const { values } = parseIssueArgs(args);

  if (!values.title) {
    exitWithUsage("Usage: muninn issue add --title <title> [--severity 1-10] [--type bug|tech-debt] [--files <files>]");
  }

  const result = await db.run(
    `
    INSERT INTO issues (project_id, title, description, type, severity, affected_files, workaround)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    [
      projectId,
      values.title,
      values.description || null,
      values.type || "bug",
      values.severity || 5,
      values.files || null,
      values.workaround || null,
    ]
  );

  const insertedId = Number(result.lastInsertRowid);

  // Generate embedding if Voyage API is available
  if (isEmbeddingAvailable()) {
    try {
      const text = issueToText(values.title, values.description || null, values.workaround || null);
      const embedding = await generateEmbedding(text);
      if (embedding) {
        await db.run("UPDATE issues SET embedding = ? WHERE id = ?", [serializeEmbedding(embedding), insertedId]);
      }
    } catch (error) {
      logError("issueAdd:embedding", error);
    }
  }

  // Auto-create relationships with affected files
  if (values.files) {
    const fileList = safeJsonParse<string[]>(values.files, []);
    if (fileList.length > 0) {
      await autoRelateIssueFiles(db, projectId, insertedId, fileList);
    }
  }

  console.error(`\u2705 Issue #${insertedId} created`);
  outputSuccess({
    id: insertedId,
    title: values.title,
  });
}

export async function issueResolve(db: DatabaseAdapter, issueId: number, resolution: string): Promise<void> {
  if (!issueId || !resolution) {
    exitWithUsage("Usage: muninn issue resolve <id> <resolution>");
  }

  await db.run(
    `
    UPDATE issues
    SET status = 'resolved', resolution = ?, resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    [resolution, issueId]
  );

  console.error(`\u2705 Issue #${issueId} resolved`);
  outputSuccess({ id: issueId });
}

export async function issueList(db: DatabaseAdapter, projectId: number, status?: string): Promise<void> {
  const query = status
    ? "SELECT * FROM issues WHERE project_id = ? AND status = ? ORDER BY severity DESC"
    : "SELECT * FROM issues WHERE project_id = ? AND status != 'resolved' ORDER BY severity DESC";

  const params = status ? [projectId, status] : [projectId];
  const issues = await db.all<Record<string, unknown>>(query, params);

  if (issues.length === 0) {
    console.error("No open issues.");
  } else {
    console.error("\n\u{1F41B} Issues:\n");
    for (const i of issues) {
      const sevIcon = (i.severity as number) >= 8 ? "\u{1F534}" : (i.severity as number) >= 5 ? "\u{1F7E0}" : "\u{1F7E1}";
      console.error(`  ${sevIcon} #${i.id}: ${i.title} (sev ${i.severity})`);
    }
    console.error("");
  }

  outputJson(issues);
}
