/**
 * Memory commands
 * File, decision, issue, learning, pattern management
 */

import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseFileArgs, parseDecisionArgs, parseIssueArgs, parseLearnArgs, parsePatternArgs, parseDebtArgs } from "../utils/validation";
import { outputJson, outputSuccess, computeContentHash, getFileMtime } from "../utils/format";
import { logError, exitWithUsage } from "../utils/errors";
import { getGlobalDb, closeGlobalDb } from "../database/connection";
import { addGlobalLearning, addPattern, searchPatterns, getAllPatterns, listTechDebt, addTechDebt, resolveTechDebt } from "../database/queries/search";
import {
  generateEmbedding,
  serializeEmbedding,
  isEmbeddingAvailable,
  fileToText,
  decisionToText,
  issueToText,
  learningToText,
} from "../embeddings";
import { autoRelateIssueFiles, autoRelateLearningFiles } from "./relationships";
import { trackDecisionMade } from "./session";
import { safeJsonParse } from "../utils/errors";

// ============================================================================
// File Commands
// ============================================================================

export async function fileAdd(db: Database, projectId: number, args: string[]): Promise<void> {
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
      logError('fileAdd:readFile', error);
    }
  }

  db.run(`
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
  `, [
    projectId,
    values.path,
    values.type || null,
    values.purpose || null,
    values.fragility || 0,
    values.fragilityReason || null,
    values.status || "active",
    contentHash,
    fsMtime,
  ]);

  // Generate embedding if Voyage API is available
  if (isEmbeddingAvailable()) {
    try {
      const text = fileToText(values.path, values.purpose || null);
      const embedding = await generateEmbedding(text);
      if (embedding) {
        // Get the ID (either new insert or existing record)
        const file = db.query<{ id: number }, [number, string]>(
          "SELECT id FROM files WHERE project_id = ? AND path = ?"
        ).get(projectId, values.path);
        if (file) {
          db.run("UPDATE files SET embedding = ? WHERE id = ?", [
            serializeEmbedding(embedding),
            file.id,
          ]);
        }
      }
    } catch (error) {
      logError("fileAdd:embedding", error);
    }
  }

  console.error(`✅ File '${values.path}' added/updated`);
  outputSuccess({ path: values.path });
}

export function fileGet(db: Database, projectId: number, path: string): void {
  if (!path) {
    exitWithUsage("Usage: muninn file get <path>");
  }

  const file = db.query<Record<string, unknown>, [number, string]>(`
    SELECT * FROM files WHERE project_id = ? AND path = ?
  `).get(projectId, path);

  if (!file) {
    outputJson({ found: false });
    return;
  }

  const symbols = db.query<Record<string, unknown>, [number]>(`
    SELECT id, name, type, purpose, signature FROM symbols WHERE file_id = ?
  `).all(file.id as number);

  outputJson({ found: true, ...file, symbols });
}

export function fileList(db: Database, projectId: number, filter?: string): void {
  let query = "SELECT path, type, purpose, fragility, status FROM files WHERE project_id = ?";
  const params: (number | string)[] = [projectId];

  if (filter) {
    query += " AND (type = ? OR status = ?)";
    params.push(filter, filter);
  }

  const files = db.query<Record<string, unknown>, (number | string)[]>(query).all(...params);
  outputJson(files);
}

// ============================================================================
// Decision Commands
// ============================================================================

export async function decisionAdd(db: Database, projectId: number, args: string[]): Promise<void> {
  const { values } = parseDecisionArgs(args);

  if (!values.title || !values.decision) {
    exitWithUsage("Usage: muninn decision add --title <title> --decision <decision> [--reasoning <why>] [--affects <files>]");
  }

  const result = db.run(`
    INSERT INTO decisions (project_id, title, decision, reasoning, affects)
    VALUES (?, ?, ?, ?, ?)
  `, [
    projectId,
    values.title,
    values.decision,
    values.reasoning || null,
    values.affects || null,
  ]);

  const insertedId = Number(result.lastInsertRowid);

  // Track decision in current session (for session → decision relationship)
  trackDecisionMade(db, projectId, insertedId);

  // Generate embedding if Voyage API is available
  if (isEmbeddingAvailable()) {
    try {
      const text = decisionToText(values.title, values.decision, values.reasoning || null);
      const embedding = await generateEmbedding(text);
      if (embedding) {
        db.run("UPDATE decisions SET embedding = ? WHERE id = ?", [
          serializeEmbedding(embedding),
          insertedId,
        ]);
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

export function decisionList(db: Database, projectId: number): void {
  const decisions = db.query<Record<string, unknown>, [number]>(`
    SELECT id, title, decision, reasoning, affects, status, decided_at
    FROM decisions
    WHERE project_id = ? AND status = 'active'
    ORDER BY decided_at DESC
  `).all(projectId);

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

export async function issueAdd(db: Database, projectId: number, args: string[]): Promise<void> {
  const { values } = parseIssueArgs(args);

  if (!values.title) {
    exitWithUsage("Usage: muninn issue add --title <title> [--severity 1-10] [--type bug|tech-debt] [--files <files>]");
  }

  const result = db.run(`
    INSERT INTO issues (project_id, title, description, type, severity, affected_files, workaround)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    projectId,
    values.title,
    values.description || null,
    values.type || "bug",
    values.severity || 5,
    values.files || null,
    values.workaround || null,
  ]);

  const insertedId = Number(result.lastInsertRowid);

  // Generate embedding if Voyage API is available
  if (isEmbeddingAvailable()) {
    try {
      const text = issueToText(values.title, values.description || null, values.workaround || null);
      const embedding = await generateEmbedding(text);
      if (embedding) {
        db.run("UPDATE issues SET embedding = ? WHERE id = ?", [
          serializeEmbedding(embedding),
          insertedId,
        ]);
      }
    } catch (error) {
      logError("issueAdd:embedding", error);
    }
  }

  // Auto-create relationships with affected files
  if (values.files) {
    const fileList = safeJsonParse<string[]>(values.files, []);
    if (fileList.length > 0) {
      autoRelateIssueFiles(db, projectId, insertedId, fileList);
    }
  }

  console.error(`✅ Issue #${insertedId} created`);
  outputSuccess({
    id: insertedId,
    title: values.title,
  });
}

export function issueResolve(db: Database, issueId: number, resolution: string): void {
  if (!issueId || !resolution) {
    exitWithUsage("Usage: muninn issue resolve <id> <resolution>");
  }

  db.run(`
    UPDATE issues
    SET status = 'resolved', resolution = ?, resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [resolution, issueId]);

  console.error(`✅ Issue #${issueId} resolved`);
  outputSuccess({ id: issueId });
}

export function issueList(db: Database, projectId: number, status?: string): void {
  const query = status
    ? "SELECT * FROM issues WHERE project_id = ? AND status = ? ORDER BY severity DESC"
    : "SELECT * FROM issues WHERE project_id = ? AND status != 'resolved' ORDER BY severity DESC";

  const params = status ? [projectId, status] : [projectId];
  const issues = db.query<Record<string, unknown>, (number | string)[]>(query).all(...params);

  if (issues.length === 0) {
    console.error("No open issues.");
  } else {
    console.error("\n🐛 Issues:\n");
    for (const i of issues) {
      const sevIcon = (i.severity as number) >= 8 ? '🔴' : (i.severity as number) >= 5 ? '🟠' : '🟡';
      console.error(`  ${sevIcon} #${i.id}: ${i.title} (sev ${i.severity})`);
    }
    console.error("");
  }

  outputJson(issues);
}

// ============================================================================
// Learning Commands
// ============================================================================

export async function learnAdd(db: Database, projectId: number, args: string[]): Promise<void> {
  const { values } = parseLearnArgs(args);

  if (!values.title || !values.content) {
    exitWithUsage("Usage: muninn learn add --title <title> --content <content> [--category pattern|gotcha] [--global]");
  }

  if (values.global) {
    const globalDb = getGlobalDb();
    const id = addGlobalLearning(
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
    const result = db.run(`
      INSERT INTO learnings (project_id, category, title, content, context)
      VALUES (?, ?, ?, ?, ?)
    `, [
      projectId,
      values.category || "pattern",
      values.title,
      values.content,
      values.context || null,
    ]);

    const insertedId = Number(result.lastInsertRowid);

    // Generate embedding if Voyage API is available
    if (isEmbeddingAvailable()) {
      try {
        const text = learningToText(values.title, values.content, values.context || null);
        const embedding = await generateEmbedding(text);
        if (embedding) {
          db.run("UPDATE learnings SET embedding = ? WHERE id = ?", [
            serializeEmbedding(embedding),
            insertedId,
          ]);
        }
      } catch (error) {
        logError("learnAdd:embedding", error);
      }
    }

    // Auto-create relationships with related files
    if (values.files) {
      const fileList = safeJsonParse<string[]>(values.files, []);
      if (fileList.length > 0) {
        autoRelateLearningFiles(db, projectId, insertedId, fileList);
      }
    }

    console.error(`✅ Learning L${insertedId} recorded`);
    outputSuccess({
      id: insertedId,
      title: values.title,
      global: false,
    });
  }
}

export function learnList(db: Database, projectId: number): void {
  const learnings = db.query<Record<string, unknown>, [number]>(`
    SELECT * FROM learnings
    WHERE project_id = ? OR project_id IS NULL
    ORDER BY times_applied DESC, confidence DESC
  `).all(projectId);

  // Also get global learnings
  const globalDb = getGlobalDb();
  const globalLearnings = globalDb.query<Record<string, unknown>, []>(`
    SELECT *, 'global' as scope FROM global_learnings
    ORDER BY times_applied DESC
    LIMIT 20
  `).all();
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

export function patternAdd(_db: Database, args: string[]): void {
  const { values } = parsePatternArgs(args);

  if (!values.name || !values.description) {
    exitWithUsage("Usage: muninn pattern add --name <name> --description <desc> [--example <code>] [--anti <antipattern>]");
  }

  const globalDb = getGlobalDb();
  addPattern(globalDb, values.name, values.description, values.example, values.anti, values.applies);
  closeGlobalDb();

  console.error(`✅ Pattern '${values.name}' added`);
  outputSuccess({ name: values.name });
}

export function patternSearch(_db: Database, query: string): void {
  if (!query) {
    exitWithUsage("Usage: muninn pattern search <query>");
  }

  const globalDb = getGlobalDb();
  const patterns = searchPatterns(globalDb, query);
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

export function patternList(): void {
  const globalDb = getGlobalDb();
  const patterns = getAllPatterns(globalDb);
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

export function debtAdd(args: string[]): void {
  const { values } = parseDebtArgs(args);

  if (!values.title) {
    exitWithUsage("Usage: muninn debt add --title <title> [--severity 1-10] [--effort small|medium|large] [--files <files>]");
  }

  const globalDb = getGlobalDb();
  const id = addTechDebt(
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

export function debtList(projectOnly: boolean): void {
  const globalDb = getGlobalDb();
  const debt = listTechDebt(globalDb, projectOnly ? process.cwd() : undefined);
  closeGlobalDb();

  if (debt.length === 0) {
    console.error("No open tech debt items.");
  } else {
    console.error("\n📋 Tech Debt:\n");
    for (const d of debt) {
      const sevIcon = d.severity >= 8 ? '🔴' : d.severity >= 5 ? '🟠' : '🟡';
      console.error(`  ${sevIcon} #${d.id}: ${d.title} (${d.effort || 'medium'})`);
    }
    console.error("");
  }

  outputJson(debt);
}

export function debtResolve(id: number): void {
  if (!id) {
    exitWithUsage("Usage: muninn debt resolve <id>");
  }

  const globalDb = getGlobalDb();
  resolveTechDebt(globalDb, id);
  closeGlobalDb();

  console.error(`✅ Tech debt #${id} resolved`);
  outputSuccess({ id });
}
