/**
 * File commands
 * Add, get, list, and cleanup file records.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import {
  fileToText,
  generateEmbedding,
  isEmbeddingAvailable,
  serializeEmbedding,
} from "../../embeddings";
import { exitWithUsage, logError } from "../../utils/errors.js";
import { computeContentHash, getFileMtime, outputJson, outputSuccess } from "../../utils/format.js";
import { parseFileArgs } from "../../utils/validation.js";

export async function fileAdd(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const { values } = parseFileArgs(args);

  if (!values.path) {
    exitWithUsage("Error: path is required");
  }

  // Validate path to prevent traversal attacks
  const basePath = process.cwd();
  const fullPath = resolve(basePath, values.path);
  const relativePath = relative(basePath, fullPath);

  // Reject if path escapes base directory
  if (relativePath.startsWith("..") || resolve(fullPath) !== fullPath) {
    exitWithUsage("Error: Invalid path - path traversal not allowed");
  }

  let contentHash: string | null = null;
  let fsMtime: string | null = null;

  if (existsSync(fullPath)) {
    try {
      const content = readFileSync(fullPath, "utf-8");
      contentHash = computeContentHash(content);
      fsMtime = getFileMtime(fullPath);
    } catch (error) {
      logError("fileAdd:readFile", error);
    }
  }

  await db.run(
    `
    INSERT INTO files (project_id, path, type, purpose, fragility, fragility_reason, status, content_hash, fs_modified_at, last_analyzed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(project_id, path) DO UPDATE SET
      type = excluded.type,
      purpose = excluded.purpose,
      fragility = excluded.fragility,
      fragility_reason = excluded.fragility_reason,
      status = excluded.status,
      content_hash = excluded.content_hash,
      fs_modified_at = excluded.fs_modified_at,
      last_analyzed = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `,
    [
      projectId,
      values.path,
      values.type || null,
      values.purpose || null,
      values.fragility || 0,
      values.fragilityReason || null,
      values.status || "active",
      contentHash,
      fsMtime,
    ]
  );

  // Generate embedding if Voyage API is available
  if (isEmbeddingAvailable()) {
    try {
      const text = fileToText(values.path, values.purpose || null);
      const embedding = await generateEmbedding(text);
      if (embedding) {
        // Get the ID (either new insert or existing record)
        const file = await db.get<{ id: number }>(
          "SELECT id FROM files WHERE project_id = ? AND path = ?",
          [projectId, values.path]
        );
        if (file) {
          await db.run("UPDATE files SET embedding = ? WHERE id = ?", [serializeEmbedding(embedding), file.id]);
        }
      }
    } catch (error) {
      logError("fileAdd:embedding", error);
    }
  }

  console.error(`\u2705 File '${values.path}' added/updated`);
  outputSuccess({ path: values.path });
}

export async function fileGet(db: DatabaseAdapter, projectId: number, path: string): Promise<void> {
  if (!path) {
    exitWithUsage("Usage: muninn file get <path>");
  }

  const file = await db.get<Record<string, unknown>>(
    `SELECT * FROM files WHERE project_id = ? AND path = ?`,
    [projectId, path]
  );

  if (!file) {
    outputJson({ found: false });
    return;
  }

  const symbols = await db.all<Record<string, unknown>>(
    `SELECT id, name, type, purpose, signature FROM symbols WHERE file_id = ?`,
    [file.id as number]
  );

  outputJson({ found: true, ...file, symbols });
}

export async function fileList(db: DatabaseAdapter, projectId: number, filter?: string): Promise<void> {
  let query = "SELECT path, type, purpose, fragility, status FROM files WHERE project_id = ?";
  const params: (number | string)[] = [projectId];

  if (filter) {
    query += " AND (type = ? OR status = ?)";
    params.push(filter, filter);
  }

  const files = await db.all<Record<string, unknown>>(query, params);
  outputJson(files);
}

export async function fileCleanup(db: DatabaseAdapter, projectId: number, dryRun = false): Promise<void> {
  const projectPath = process.cwd();

  // Get all files from DB
  const allFiles = await db.all<{ id: number; path: string; content_hash: string | null }>(
    "SELECT id, path, content_hash FROM files WHERE project_id = ?",
    [projectId]
  );

  let deletedCount = 0;
  let updatedCount = 0;
  const deleted: string[] = [];
  const updated: string[] = [];

  for (const file of allFiles) {
    const fullPath = file.path.startsWith("/") ? file.path : join(projectPath, file.path);

    if (!existsSync(fullPath)) {
      // File no longer exists - delete record
      if (!dryRun) {
        await db.run("DELETE FROM files WHERE id = ?", [file.id]);
      }
      deleted.push(file.path);
      deletedCount++;
    } else {
      // File exists - check if stale and update hash/timestamp
      try {
        const content = readFileSync(fullPath, "utf-8");
        const newHash = computeContentHash(content);
        const newMtime = getFileMtime(fullPath);

        if (newHash !== file.content_hash) {
          if (!dryRun) {
            await db.run(
              `UPDATE files SET
                content_hash = ?,
                fs_modified_at = ?,
                last_analyzed = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
              [newHash, newMtime, file.id]
            );
          }
          updated.push(file.path);
          updatedCount++;
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  const prefix = dryRun ? "[DRY RUN] " : "";
  console.error(`\n${prefix}\u{1F9F9} File Cleanup Results:\n`);
  console.error(`  Deleted records: ${deletedCount}`);
  console.error(`  Updated hashes: ${updatedCount}`);

  if (deletedCount > 0 && deletedCount <= 10) {
    console.error("\n  Deleted:");
    for (const p of deleted) {
      console.error(`    - ${p}`);
    }
  }

  if (updatedCount > 0 && updatedCount <= 10) {
    console.error("\n  Updated:");
    for (const p of updated) {
      console.error(`    - ${p}`);
    }
  }

  console.error("");
  outputSuccess({ deletedCount, updatedCount, deleted, updated, dryRun });
}
