/**
 * Decision commands
 * Add and list architectural decisions.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import {
  decisionToText,
  generateEmbedding,
  isEmbeddingAvailable,
  serializeEmbedding,
} from "../../embeddings";
import { exitWithUsage, logError } from "../../utils/errors.js";
import { outputJson, outputSuccess } from "../../utils/format.js";
import { parseDecisionArgs } from "../../utils/validation.js";
import {
  convertDecisionToNative,
  ensureNativeSchema,
  formatDecisionNative,
} from "../native.js";
import { trackDecisionMade } from "../session.js";

export async function decisionAdd(db: DatabaseAdapter, projectId: number, args: string[]): Promise<void> {
  const { values } = parseDecisionArgs(args);

  if (!values.title || !values.decision) {
    exitWithUsage(
      "Usage: muninn decision add --title <title> --decision <decision> [--reasoning <why>] [--affects <files>] [--influenced-by <learning_ids>]"
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

  // Track decision in current session (for session -> decision relationship)
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

  // Auto-convert to native format
  let nativeFormat: string | null = null;
  try {
    await ensureNativeSchema(db);
    const native = await convertDecisionToNative(
      values.title,
      values.decision,
      values.reasoning || null
    );

    nativeFormat = formatDecisionNative(values.title, native);

    const originalTokens = Math.ceil(`${values.title}\n${values.decision}\n${values.reasoning || ""}`.length / 4);
    const nativeTokens = Math.ceil(nativeFormat.length / 4);

    await db.run(
      `INSERT INTO native_knowledge
       (type, entities, condition, action, reasoning, confidence, source_id, source_table, native_format, original_tokens, native_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_table, source_id) DO UPDATE SET
       type = excluded.type,
       entities = excluded.entities,
       action = excluded.action,
       reasoning = excluded.reasoning,
       confidence = excluded.confidence,
       native_format = excluded.native_format,
       original_tokens = excluded.original_tokens,
       native_tokens = excluded.native_tokens`,
      [
        "decision",
        JSON.stringify(native.ent),
        null, // decisions don't have conditions
        native.choice,
        native.why,
        native.conf,
        insertedId,
        "decisions",
        nativeFormat,
        originalTokens,
        nativeTokens,
      ]
    );
  } catch (error) {
    logError("decisionAdd:nativeConvert", error);
    // Don't block decision creation on conversion failure
  }

  // Link influenced-by learnings if specified
  let linkedLearnings: number[] = [];
  if (values.influencedBy) {
    linkedLearnings = parseLearningIds(values.influencedBy);
    if (linkedLearnings.length > 0) {
      await linkDecisionToLearnings(db, insertedId, linkedLearnings);
    }
  }

  console.error(`\u2705 Decision D${insertedId} recorded`);
  if (nativeFormat) {
    console.error(`   Native: ${nativeFormat}`);
  }
  if (linkedLearnings.length > 0) {
    console.error(`   Linked to learnings: ${linkedLearnings.map((id) => `L${id}`).join(", ")}`);
  }
  outputSuccess({
    id: insertedId,
    title: values.title,
    native_format: nativeFormat,
    linked_learnings: linkedLearnings,
  });
}

/**
 * Parse learning IDs from a comma-separated string (e.g., "L12,L45" or "12,45")
 */
function parseLearningIds(input: string): number[] {
  return input
    .split(",")
    .map((s) => s.trim().replace(/^L/i, ""))
    .map((s) => parseInt(s, 10))
    .filter((id) => !Number.isNaN(id) && id > 0);
}

/**
 * Link learnings to a decision (for feedback loop)
 */
async function linkDecisionToLearnings(
  db: DatabaseAdapter,
  decisionId: number,
  learningIds: number[]
): Promise<void> {
  for (const learningId of learningIds) {
    try {
      await db.run(
        `INSERT OR REPLACE INTO decision_learnings (decision_id, learning_id, contribution)
         VALUES (?, ?, 'influenced')`,
        [decisionId, learningId]
      );
    } catch {
      // Table might not exist yet, silently ignore
    }
  }
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
    console.error("\n\u{1F4CB} Active Decisions:\n");
    for (const d of decisions) {
      console.error(`  D${d.id}: ${d.title}`);
      console.error(`     ${(d.decision as string).substring(0, 80)}...`);
    }
    console.error("");
  }

  outputJson(decisions);
}
