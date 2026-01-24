/**
 * Open Questions commands
 * Deferred question parking lot for revisiting later
 */

import type { Database } from "bun:sqlite";
import { outputSuccess } from "../utils/format";
import { generateEmbedding, serializeEmbedding, questionToText } from "../embeddings";
import { logError } from "../utils/errors";

// ============================================================================
// Add Question
// ============================================================================

export async function questionAdd(
  db: Database,
  projectId: number | null,
  question: string,
  options: { context?: string; priority?: number; sessionId?: number; global?: boolean } = {}
): Promise<number> {
  if (!question) {
    console.error("Usage: muninn questions add <question> [--priority 1-5] [--context <text>]");
    process.exit(1);
  }

  const priority = Math.max(1, Math.min(5, options.priority ?? 3));

  if (options.global) {
    return questionAddGlobal(db, question, options.context, priority);
  }

  const result = db.run(`
    INSERT INTO open_questions (project_id, question, context, priority, session_id)
    VALUES (?, ?, ?, ?, ?)
  `, [projectId, question, options.context ?? null, priority, options.sessionId ?? null]);

  const id = Number(result.lastInsertRowid);

  // Update FTS
  db.run(`
    INSERT INTO fts_questions(rowid, question, context)
    VALUES (?, ?, ?)
  `, [id, question, options.context ?? null]);

  // Generate embedding async
  try {
    const embedding = await generateEmbedding(questionToText(question, options.context ?? null));
    if (embedding) {
      db.run("UPDATE open_questions SET embedding = ? WHERE id = ?", [
        serializeEmbedding(embedding),
        id,
      ]);
    }
  } catch (error) {
    logError("questions:embedding", error);
  }

  const priorityLabel = ['', 'critical', 'high', 'medium', 'low', 'someday'][priority];
  console.error(`\n❓ Question parked (#${id}) [${priorityLabel}]`);
  console.error(`   "${question}"`);

  outputSuccess({ id, question, priority, priorityLabel });
  return id;
}

function questionAddGlobal(
  db: Database,
  question: string,
  context: string | undefined,
  priority: number
): number {
  const result = db.run(`
    INSERT INTO global_open_questions (question, context, priority)
    VALUES (?, ?, ?)
  `, [question, context ?? null, priority]);

  const id = Number(result.lastInsertRowid);
  console.error(`\n❓ Global question parked (#${id})`);
  outputSuccess({ id, question, priority, global: true });
  return id;
}

// ============================================================================
// List Questions
// ============================================================================

export function questionList(
  db: Database,
  projectId: number | null,
  options: { status?: string; global?: boolean } = {}
): void {
  const status = options.status ?? 'open';

  if (options.global) {
    const results = db.query<{
      id: number; question: string; context: string | null;
      priority: number; status: string; resolution: string | null;
      created_at: string;
    }, [string]>(`
      SELECT * FROM global_open_questions
      WHERE status = ?
      ORDER BY priority ASC, created_at DESC
    `).all(status);

    console.error(`\n❓ Global Open Questions (${results.length})\n`);
    for (const q of results) {
      const pri = ['', 'P1', 'P2', 'P3', 'P4', 'P5'][q.priority];
      console.error(`  [${pri}] #${q.id}: ${q.question}`);
      if (q.context) console.error(`       Context: ${q.context.slice(0, 50)}`);
    }
    outputSuccess({ questions: results, global: true });
    return;
  }

  const results = db.query<{
    id: number; question: string; context: string | null;
    priority: number; status: string; resolution: string | null;
    session_id: number | null; created_at: string;
  }, [number | null, string]>(`
    SELECT * FROM open_questions
    WHERE (project_id = ?1 OR project_id IS NULL) AND status = ?2
    ORDER BY priority ASC, created_at DESC
  `).all(projectId, status);

  console.error(`\n❓ Open Questions (${results.length})\n`);
  for (const q of results) {
    const pri = ['', 'P1', 'P2', 'P3', 'P4', 'P5'][q.priority];
    console.error(`  [${pri}] #${q.id}: ${q.question}`);
    if (q.context) console.error(`       Context: ${q.context.slice(0, 50)}`);
  }

  outputSuccess({ questions: results });
}

// ============================================================================
// Resolve Question
// ============================================================================

export function questionResolve(
  db: Database,
  id: number,
  resolution: string,
  status: 'resolved' | 'dropped' = 'resolved'
): void {
  if (!id || !resolution) {
    console.error("Usage: muninn questions resolve <id> <resolution>");
    process.exit(1);
  }

  const question = db.query<{ id: number; question: string }, [number]>(
    "SELECT id, question FROM open_questions WHERE id = ?"
  ).get(id);

  if (!question) {
    console.error(`❌ Question #${id} not found`);
    process.exit(1);
  }

  db.run(`
    UPDATE open_questions
    SET status = ?, resolution = ?, resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [status, resolution, id]);

  const emoji = status === 'resolved' ? '✅' : '🗑️';
  console.error(`\n${emoji} Question #${id} ${status}`);
  console.error(`   "${question.question}"`);
  console.error(`   Resolution: ${resolution}`);

  outputSuccess({ id, status, resolution });
}

// ============================================================================
// Get Open Questions for Resume
// ============================================================================

export function getOpenQuestionsForResume(
  db: Database,
  projectId: number
): Array<{ id: number; question: string; priority: number }> {
  try {
    return db.query<{ id: number; question: string; priority: number }, [number]>(`
      SELECT id, question, priority FROM open_questions
      WHERE (project_id = ? OR project_id IS NULL) AND status = 'open'
      ORDER BY priority ASC
      LIMIT 5
    `).all(projectId);
  } catch {
    return [];
  }
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleQuestionsCommand(
  db: Database,
  projectId: number,
  args: string[]
): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "add": {
      const priorityIdx = args.indexOf("--priority");
      const priority = priorityIdx !== -1 ? parseInt(args[priorityIdx + 1]) : undefined;
      const contextIdx = args.indexOf("--context");
      const context = contextIdx !== -1 ? args[contextIdx + 1] : undefined;
      const isGlobal = args.includes("--global");

      // Filter out flags and their arguments
      const questionParts: string[] = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--priority" || args[i] === "--context") { i++; continue; }
        if (args[i] === "--global") { continue; }
        questionParts.push(args[i]);
      }
      const question = questionParts.join(" ");
      await questionAdd(db, isGlobal ? null : projectId, question, { priority, context, global: isGlobal });
      break;
    }

    case "list": {
      const statusIdx = args.indexOf("--status");
      const status = statusIdx !== -1 ? args[statusIdx + 1] : undefined;
      const isGlobal = args.includes("--global");
      questionList(db, projectId, { status, global: isGlobal });
      break;
    }

    case "resolve": {
      const id = parseInt(args[1]);
      const resolution = args.slice(2).filter(a => !a.startsWith("--")).join(" ");
      questionResolve(db, id, resolution);
      break;
    }

    case "drop": {
      const id = parseInt(args[1]);
      const reason = args.slice(2).filter(a => !a.startsWith("--")).join(" ") || "Dropped";
      questionResolve(db, id, reason, 'dropped');
      break;
    }

    default:
      console.error("Usage: muninn questions <add|list|resolve|drop> [args]");
  }
}
