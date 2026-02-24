/**
 * Learning, pattern, and tech debt commands.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import { closeGlobalDb, getGlobalDb } from "../../database/connection.js";
import {
  addGlobalLearning,
  addPattern,
  addTechDebt,
  getAllPatterns,
  listTechDebt,
  resolveTechDebt,
  searchPatterns,
} from "../../database/queries/search.js";
import {
  generateEmbedding,
  isEmbeddingAvailable,
  learningToText,
  serializeEmbedding,
} from "../../embeddings";
import { exitWithUsage, logError, safeJsonParse } from "../../utils/errors.js";
import { outputJson, outputSuccess } from "../../utils/format.js";
import {
  parseDebtArgs,
  parseLearnArgs,
  parsePatternArgs,
} from "../../utils/validation.js";
import { autoRelateLearningFiles } from "../relationships/add.js";
import {
  convertToNative,
  ensureNativeSchema,
  formatNative,
} from "../native.js";

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

    console.error(`\u2705 Global learning L${id} recorded`);
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

    // Auto-convert to native format
    let nativeFormat: string | null = null;
    try {
      await ensureNativeSchema(db);
      const native = await convertToNative(
        values.title,
        values.content,
        values.category || "pattern"
      );

      nativeFormat = formatNative({
        id: 0,
        type: native.type as "pattern" | "gotcha" | "decision" | "fact" | "pref",
        entities: native.ent,
        condition: native.when,
        action: native.do,
        reasoning: native.why,
        confidence: native.conf,
        embedding: null,
        sourceId: insertedId,
        sourceTable: "learnings",
      });

      const originalTokens = Math.ceil(`${values.title}\n${values.content}`.length / 4);
      const nativeTokens = Math.ceil(nativeFormat.length / 4);

      await db.run(
        `INSERT INTO native_knowledge
         (type, entities, condition, action, reasoning, confidence, source_id, source_table, native_format, original_tokens, native_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_table, source_id) DO UPDATE SET
         type = excluded.type,
         entities = excluded.entities,
         condition = excluded.condition,
         action = excluded.action,
         reasoning = excluded.reasoning,
         confidence = excluded.confidence,
         native_format = excluded.native_format,
         original_tokens = excluded.original_tokens,
         native_tokens = excluded.native_tokens`,
        [
          native.type,
          JSON.stringify(native.ent),
          native.when,
          native.do,
          native.why,
          native.conf,
          insertedId,
          "learnings",
          nativeFormat,
          originalTokens,
          nativeTokens,
        ]
      );
    } catch (error) {
      logError("learnAdd:nativeConvert", error);
      // Don't block learning creation on conversion failure
    }

    const foundationalNote = isFoundational ? ` (foundational, review every ${reviewAfterSessions} sessions)` : "";
    console.error(`\u2705 Learning L${insertedId} recorded${foundationalNote}`);
    if (nativeFormat) {
      console.error(`   Native: ${nativeFormat}`);
    }
    outputSuccess({
      id: insertedId,
      title: values.title,
      global: false,
      foundational: !!isFoundational,
      reviewAfterSessions,
      native_format: nativeFormat,
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

  console.error("\n\u{1F4A1} Learnings:\n");
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

  console.error(`\u2705 Pattern '${values.name}' added`);
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
    console.error("\n\u{1F4A1} Patterns:\n");
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
    console.error("\n\u{1F4A1} Pattern Library:\n");
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

  console.error(`\u2705 Tech debt item #${id} added`);
  outputSuccess({ id, title: values.title });
}

export async function debtList(projectOnly: boolean): Promise<void> {
  const globalDb = await getGlobalDb();
  const debt = await listTechDebt(globalDb, projectOnly ? process.cwd() : undefined);
  closeGlobalDb();

  if (debt.length === 0) {
    console.error("No open tech debt items.");
  } else {
    console.error("\n\u{1F4CB} Tech Debt:\n");
    for (const d of debt) {
      const sevIcon = d.severity >= 8 ? "\u{1F534}" : d.severity >= 5 ? "\u{1F7E0}" : "\u{1F7E1}";
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

  console.error(`\u2705 Tech debt #${id} resolved`);
  outputSuccess({ id });
}
