/**
 * Memory commands
 * File, decision, issue, learning, pattern management
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { closeGlobalDb, getGlobalDb } from "../database/connection";
import {
  addGlobalLearning,
  addPattern,
  addTechDebt,
  getAllPatterns,
  listTechDebt,
  resolveTechDebt,
  searchPatterns,
} from "../database/queries/search";
import {
  decisionToText,
  fileToText,
  generateEmbedding,
  isEmbeddingAvailable,
  issueToText,
  learningToText,
  serializeEmbedding,
} from "../embeddings";
import { exitWithUsage, logError, safeJsonParse } from "../utils/errors";
import { computeContentHash, getFileMtime, outputJson, outputSuccess } from "../utils/format";
import {
  parseDebtArgs,
  parseDecisionArgs,
  parseFileArgs,
  parseIssueArgs,
  parseLearnArgs,
  parsePatternArgs,
} from "../utils/validation";
import { autoRelateIssueFiles, autoRelateLearningFiles } from "./relationships";
import { trackDecisionMade } from "./session";

// ============================================================================
// File Commands
// ============================================================================

export async function fileAdd(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const { values } = parseFileArgs(args);

  if (!values.path) {
    exitWithUsage("Error: path is required");
  }

  const fullPath = join(process.cwd(), values.path);
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

  console.error(`✅ File '${values.path}' added/updated`);
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
  console.error(`\n${prefix}🧹 File Cleanup Results:\n`);
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

// ============================================================================
// Decision Commands
// ============================================================================

export async function decisionAdd(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const { values } = parseDecisionArgs(args);

  if (!values.title || !values.decision) {
    exitWithUsage(
      "Usage: muninn decision add --title <title> --decision <decision> [--reasoning <why>] [--affects <files>]"
    );
  }

  const result = await db.run(
    `
    INSERT INTO decisions (project_id, title, decision, reasoning, affects)
    VALUES (?, ?, ?, ?, ?)
  `,
    [projectId, values.title, values.decision, values.reasoning || null, values.affects || null]
  );

  const insertedId = Number(result.lastInsertRowid);

  // Track decision in current session (for session → decision relationship)
  await trackDecisionMade(db, projectId, insertedId);

  // Generate embedding if Voyage API is available
  if (isEmbeddingAvailable()) {
    try {
      const text = decisionToText(values.title, values.decision, values.reasoning || null);
      const embedding = await generateEmbedding(text);
      if (embedding) {
        await db.run("UPDATE decisions SET embedding = ? WHERE id = ?", [serializeEmbedding(embedding), insertedId]);
      }
    } catch (error) {
      logError("decisionAdd:embedding", error);
    }
  }

  console.error(`✅ Decision D${insertedId} recorded`);
  outputSuccess({
    id: insertedId,
    title: values.title,
  });
}

export async function decisionList(db: DatabaseAdapter, projectId: number): Promise<void> {
  const decisions = await db.all<Record<string, unknown>>(
    `SELECT id, title, decision, reasoning, affects, status, decided_at
    FROM decisions
    WHERE project_id = ? AND status = 'active'
    ORDER BY decided_at DESC`,
    [projectId]
  );

  if (decisions.length === 0) {
    console.error("No active decisions recorded.");
  } else {
    console.error("\n📋 Active Decisions:\n");
    for (const d of decisions) {
      console.error(`  D${d.id}: ${d.title}`);
      console.error(`     ${(d.decision as string).substring(0, 80)}...`);
    }
    console.error("");
  }

  outputJson(decisions);
}

// ============================================================================
// Issue Commands
// ============================================================================

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

  console.error(`✅ Issue #${insertedId} created`);
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

  console.error(`✅ Issue #${issueId} resolved`);
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
    console.error("\n🐛 Issues:\n");
    for (const i of issues) {
      const sevIcon = (i.severity as number) >= 8 ? "🔴" : (i.severity as number) >= 5 ? "🟠" : "🟡";
      console.error(`  ${sevIcon} #${i.id}: ${i.title} (sev ${i.severity})`);
    }
    console.error("");
  }

  outputJson(issues);
}

// ============================================================================
// Learning Commands
// ============================================================================

export async function learnAdd(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const { values } = parseLearnArgs(args);

  if (!values.title || !values.content) {
    exitWithUsage(
      "Usage: muninn learn add --title <title> --content <content> [--category pattern|gotcha] [--global] [--foundational] [--review-after N]"
    );
  }

  if (values.global) {
    const globalDb = await getGlobalDb();
    const id = await addGlobalLearning(
      globalDb,
      values.category || "pattern",
      values.title,
      values.content,
      values.context,
      process.cwd()
    );
    closeGlobalDb();

    console.error(`✅ Global learning L${id} recorded`);
    outputSuccess({
      id,
      title: values.title,
      global: true,
    });
  } else {
    // Foundational learnings get review cycle settings
    const isFoundational = values.foundational ? 1 : 0;
    const reviewAfterSessions = values.foundational ? (values.reviewAfter || 30) : null;

    const result = await db.run(
      `
      INSERT INTO learnings (project_id, category, title, content, context, foundational, review_after_sessions, review_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        projectId,
        values.category || "pattern",
        values.title,
        values.content,
        values.context || null,
        isFoundational,
        reviewAfterSessions,
        isFoundational ? "pending" : null,
      ]
    );

    const insertedId = Number(result.lastInsertRowid);

    // Generate embedding if Voyage API is available
    if (isEmbeddingAvailable()) {
      try {
        const text = learningToText(values.title, values.content, values.context || null);
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await db.run("UPDATE learnings SET embedding = ? WHERE id = ?", [serializeEmbedding(embedding), insertedId]);
        }
      } catch (error) {
        logError("learnAdd:embedding", error);
      }
    }

    // Auto-create relationships with related files
    if (values.files) {
      const fileList = safeJsonParse<string[]>(values.files, []);
      if (fileList.length > 0) {
        await autoRelateLearningFiles(db, projectId, insertedId, fileList);
      }
    }

    const foundationalNote = isFoundational ? " (foundational, review every " + reviewAfterSessions + " sessions)" : "";
    console.error(`✅ Learning L${insertedId} recorded${foundationalNote}`);
    outputSuccess({
      id: insertedId,
      title: values.title,
      global: false,
      foundational: !!isFoundational,
      reviewAfterSessions,
    });
  }
}

export async function learnList(db: DatabaseAdapter, projectId: number): Promise<void> {
  const learnings = await db.all<Record<string, unknown>>(
    `SELECT * FROM learnings
    WHERE project_id = ? OR project_id IS NULL
    ORDER BY times_applied DESC, confidence DESC`,
    [projectId]
  );

  // Also get global learnings
  const globalDb = await getGlobalDb();
  const globalLearnings = await globalDb.all<Record<string, unknown>>(
    `SELECT *, 'global' as scope FROM global_learnings
    ORDER BY times_applied DESC
    LIMIT 20`
  );
  closeGlobalDb();

  console.error("\n💡 Learnings:\n");
  console.error("  Project:");
  for (const l of learnings.slice(0, 5)) {
    console.error(`    L${l.id}: ${l.title}`);
  }
  console.error("\n  Global:");
  for (const l of globalLearnings.slice(0, 5)) {
    console.error(`    G${l.id}: ${l.title}`);
  }
  console.error("");

  outputJson({ project: learnings, global: globalLearnings });
}

// ============================================================================
// Pattern Commands
// ============================================================================

export async function patternAdd(_db: DatabaseAdapter, args: string[]): Promise<void> {
  const { values } = parsePatternArgs(args);

  if (!values.name || !values.description) {
    exitWithUsage(
      "Usage: muninn pattern add --name <name> --description <desc> [--example <code>] [--anti <antipattern>]"
    );
  }

  const globalDb = await getGlobalDb();
  await addPattern(globalDb, values.name, values.description, values.example, values.anti, values.applies);
  closeGlobalDb();

  console.error(`✅ Pattern '${values.name}' added`);
  outputSuccess({ name: values.name });
}

export async function patternSearch(_db: DatabaseAdapter, query: string): Promise<void> {
  if (!query) {
    exitWithUsage("Usage: muninn pattern search <query>");
  }

  const globalDb = await getGlobalDb();
  const patterns = await searchPatterns(globalDb, query);
  closeGlobalDb();

  if (patterns.length === 0) {
    console.error("No patterns found.");
  } else {
    console.error("\n💡 Patterns:\n");
    for (const p of patterns) {
      console.error(`  ${p.name}: ${p.description.substring(0, 60)}...`);
    }
    console.error("");
  }

  outputJson(patterns);
}

export async function patternList(): Promise<void> {
  const globalDb = await getGlobalDb();
  const patterns = await getAllPatterns(globalDb);
  closeGlobalDb();

  if (patterns.length === 0) {
    console.error("No patterns recorded. Add one with: muninn pattern add --name <name> --description <desc>");
  } else {
    console.error("\n💡 Pattern Library:\n");
    for (const p of patterns) {
      console.error(`  ${p.name}: ${p.description.substring(0, 60)}...`);
    }
    console.error("");
  }

  outputJson(patterns);
}

// ============================================================================
// Tech Debt Commands
// ============================================================================

export async function debtAdd(args: string[]): Promise<void> {
  const { values } = parseDebtArgs(args);

  if (!values.title) {
    exitWithUsage(
      "Usage: muninn debt add --title <title> [--severity 1-10] [--effort small|medium|large] [--files <files>]"
    );
  }

  const globalDb = await getGlobalDb();
  const id = await addTechDebt(
    globalDb,
    process.cwd(),
    values.title,
    values.description,
    values.severity,
    values.effort,
    values.files
  );
  closeGlobalDb();

  console.error(`✅ Tech debt item #${id} added`);
  outputSuccess({ id, title: values.title });
}

export async function debtList(projectOnly: boolean): Promise<void> {
  const globalDb = await getGlobalDb();
  const debt = await listTechDebt(globalDb, projectOnly ? process.cwd() : undefined);
  closeGlobalDb();

  if (debt.length === 0) {
    console.error("No open tech debt items.");
  } else {
    console.error("\n📋 Tech Debt:\n");
    for (const d of debt) {
      const sevIcon = d.severity >= 8 ? "🔴" : d.severity >= 5 ? "🟠" : "🟡";
      console.error(`  ${sevIcon} #${d.id}: ${d.title} (${d.effort || "medium"})`);
    }
    console.error("");
  }

  outputJson(debt);
}

export async function debtResolve(id: number): Promise<void> {
  if (!id) {
    exitWithUsage("Usage: muninn debt resolve <id>");
  }

  const globalDb = await getGlobalDb();
  await resolveTechDebt(globalDb, id);
  closeGlobalDb();

  console.error(`✅ Tech debt #${id} resolved`);
  outputSuccess({ id });
}
