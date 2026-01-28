/**
 * Reflection Question Generator
 * Generate thoughtful questions from patterns and contradictions
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseAdapter } from "../database/adapter";
import type { PatternInstance, ReflectionQuestion, ReflectionQuestionType } from "../types";
import { outputJson, outputError } from "../utils/format";

// ============================================================================
// LLM Question Generation
// ============================================================================

const REFLECTION_PROMPT = `You are helping a developer reflect on their practices and decisions.
Given these patterns and contradictions from their conversation history, generate thoughtful reflection questions.

Question types:
- pattern: "You consistently do X. Has this served you well? Any exceptions?"
- contradiction: "Conv A says X, Conv B says Y. Which is your current view?"
- validation: "This principle appeared N times. Is it still valid?"
- synthesis: "These related learnings suggest a deeper principle. Can you articulate it?"

Return JSON array of 3-5 most valuable questions:
[
  {
    "type": "pattern|contradiction|validation|synthesis",
    "question": "The actual question text",
    "context": "Why this question matters",
    "confidence": 0.8
  }
]

Focus on:
1. Questions that help reconcile contradictions
2. Questions that validate frequently-used patterns
3. Questions that could surface deeper principles
4. Questions about potentially outdated beliefs

Be concise. Skip trivial patterns.`;

interface GeneratedQuestion {
  type: ReflectionQuestionType;
  question: string;
  context: string;
  confidence: number;
}

async function generateQuestionsWithLLM(
  patterns: PatternInstance[],
  contradictions: PatternInstance[]
): Promise<GeneratedQuestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("⚠️  ANTHROPIC_API_KEY not set, using rule-based generation");
    return generateQuestionsRuleBased(patterns, contradictions);
  }

  const client = new Anthropic({ apiKey });

  // Format patterns for the prompt
  const patternSummary = patterns
    .slice(0, 10)
    .map((p) => `[${p.pattern_type}] ${p.title} (${p.frequency}x, ${Math.round(p.aggregate_confidence * 100)}%)`)
    .join("\n");

  const contradictionSummary = contradictions
    .slice(0, 5)
    .map((c) => `${c.title}: ${c.description?.slice(0, 100) || "No description"}`)
    .join("\n");

  const content = `
PATTERNS (recurring themes):
${patternSummary || "None found"}

CONTRADICTIONS (conflicting advice):
${contradictionSummary || "None found"}
`.trim();

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content }],
      system: REFLECTION_PROMPT,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      console.error("⚠️  No valid JSON in LLM response, using rule-based");
      return generateQuestionsRuleBased(patterns, contradictions);
    }

    return JSON.parse(jsonMatch[0]) as GeneratedQuestion[];
  } catch (error) {
    console.error(`⚠️  LLM error: ${error}, using rule-based generation`);
    return generateQuestionsRuleBased(patterns, contradictions);
  }
}

/**
 * Rule-based question generation (fallback when LLM not available)
 */
function generateQuestionsRuleBased(
  patterns: PatternInstance[],
  contradictions: PatternInstance[]
): GeneratedQuestion[] {
  const questions: GeneratedQuestion[] = [];

  // Generate questions for contradictions
  for (const c of contradictions.slice(0, 3)) {
    questions.push({
      type: "contradiction",
      question: `Your notes show conflicting views on "${c.title}". What's your current stance?`,
      context: c.description || "Multiple conflicting entries found",
      confidence: 0.9,
    });
  }

  // Generate validation questions for strong patterns
  const strongPatterns = patterns.filter((p) => p.aggregate_confidence >= 0.85 && p.frequency >= 3);
  for (const p of strongPatterns.slice(0, 2)) {
    questions.push({
      type: "validation",
      question: `You've mentioned "${p.title}" ${p.frequency} times. Is this principle still serving you well?`,
      context: p.description || "Frequently mentioned pattern",
      confidence: 0.85,
    });
  }

  // Generate synthesis questions for related patterns
  const principles = patterns.filter((p) => p.pattern_type === "principle");
  if (principles.length >= 2) {
    questions.push({
      type: "synthesis",
      question: `You have ${principles.length} guiding principles. Do they form a coherent philosophy?`,
      context: principles.map((p) => p.title).slice(0, 3).join(", "),
      confidence: 0.7,
    });
  }

  return questions;
}

// ============================================================================
// Database Operations
// ============================================================================

async function storeQuestions(
  db: DatabaseAdapter,
  projectId: number,
  questions: GeneratedQuestion[],
  patterns: PatternInstance[],
  contradictions: PatternInstance[]
): Promise<number> {
  let stored = 0;

  for (const q of questions) {
    // Find related pattern/contradiction
    const related = q.type === "contradiction"
      ? contradictions.find((c) => q.context?.includes(c.title) || q.question.includes(c.title))
      : patterns.find((p) => q.context?.includes(p.title) || q.question.includes(p.title));

    // Check if similar question already exists
    const existing = await db.get<{ id: number }>(
      `SELECT id FROM reflection_questions
       WHERE project_id = ? AND question = ? AND status = 'open'`,
      [projectId, q.question]
    );

    if (existing) continue;

    await db.run(
      `INSERT INTO reflection_questions
       (project_id, pattern_id, question_type, question, context, confidence, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', datetime('now'))`,
      [
        projectId,
        related?.id || null,
        q.type,
        q.question,
        q.context,
        q.confidence,
      ]
    );
    stored++;
  }

  return stored;
}

/**
 * Generate reflection questions from analysis
 */
export async function generateReflectionQuestions(
  db: DatabaseAdapter,
  projectId: number,
  options: { save?: boolean }
): Promise<void> {
  // Get patterns and contradictions
  const patterns = await db.all<PatternInstance>(
    `SELECT * FROM pattern_instances
     WHERE project_id = ? AND pattern_type != 'contradiction' AND status = 'active'
     ORDER BY frequency DESC
     LIMIT 20`,
    [projectId]
  );

  const contradictions = await db.all<PatternInstance>(
    `SELECT * FROM pattern_instances
     WHERE project_id = ? AND pattern_type = 'contradiction' AND status = 'active'`,
    [projectId]
  );

  if (patterns.length === 0 && contradictions.length === 0) {
    console.error("⚠️  No patterns or contradictions found. Run `muninn convo analyze` first.");
    return;
  }

  console.error("\n🪞 Generating reflection questions...\n");

  const questions = await generateQuestionsWithLLM(patterns, contradictions);

  console.error(`Generated ${questions.length} questions:\n`);

  for (const q of questions) {
    const icon =
      q.type === "contradiction" ? "⚠️" :
      q.type === "validation" ? "✓" :
      q.type === "synthesis" ? "🔗" : "📊";
    console.error(`${icon} [${q.type}] ${q.question}`);
    if (q.context) {
      console.error(`   Context: ${q.context}`);
    }
    console.error("");
  }

  if (options.save) {
    const stored = await storeQuestions(db, projectId, questions, patterns, contradictions);
    console.error(`✅ Saved ${stored} new questions to database`);
  } else {
    console.error("Use --save to persist these questions");
  }

  outputJson({ questions, saved: options.save ? questions.length : 0 });
}

/**
 * List reflection questions
 */
export async function listQuestions(
  db: DatabaseAdapter,
  projectId: number,
  options: { status?: string }
): Promise<void> {
  const status = options.status || "open";

  const questions = await db.all<ReflectionQuestion>(
    `SELECT * FROM reflection_questions
     WHERE project_id = ? AND status = ?
     ORDER BY created_at DESC`,
    [projectId, status]
  );

  console.error(`\n🪞 Reflection Questions (${status}): ${questions.length}\n`);

  if (questions.length === 0) {
    console.error("   No questions found.");
    console.error("   Run `muninn convo reflect --save` to generate questions.\n");
    return;
  }

  for (const q of questions) {
    const icon =
      q.question_type === "contradiction" ? "⚠️" :
      q.question_type === "validation" ? "✓" :
      q.question_type === "synthesis" ? "🔗" : "📊";

    console.error(`  #${q.id} ${icon} [${q.question_type}]`);
    console.error(`     ${q.question}`);
    if (q.context) {
      console.error(`     Context: ${q.context}`);
    }
    if (q.answer) {
      console.error(`     Answer: ${q.answer}`);
    }
    console.error("");
  }

  outputJson(questions);
}

/**
 * Answer a reflection question
 */
export async function answerQuestion(
  db: DatabaseAdapter,
  questionId: number,
  answer: string
): Promise<void> {
  const question = await db.get<ReflectionQuestion>(
    "SELECT * FROM reflection_questions WHERE id = ?",
    [questionId]
  );

  if (!question) {
    outputError(`Question #${questionId} not found`);
    return;
  }

  await db.run(
    `UPDATE reflection_questions
     SET answer = ?, status = 'answered', answered_at = datetime('now')
     WHERE id = ?`,
    [answer, questionId]
  );

  console.error(`✅ Answered question #${questionId}`);
  console.error(`   Q: ${question.question}`);
  console.error(`   A: ${answer}\n`);

  outputJson({ id: questionId, question: question.question, answer, status: "answered" });
}

/**
 * Dismiss a reflection question
 */
export async function dismissQuestion(
  db: DatabaseAdapter,
  questionId: number
): Promise<void> {
  const question = await db.get<ReflectionQuestion>(
    "SELECT * FROM reflection_questions WHERE id = ?",
    [questionId]
  );

  if (!question) {
    outputError(`Question #${questionId} not found`);
    return;
  }

  await db.run(
    "UPDATE reflection_questions SET status = 'dismissed' WHERE id = ?",
    [questionId]
  );

  console.error(`✅ Dismissed question #${questionId}`);
  outputJson({ id: questionId, status: "dismissed" });
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleReflectionCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[]
): Promise<void> {
  const subCmd = args[0];
  const subArgs = args.slice(1);

  switch (subCmd) {
    case "reflect": {
      const save = subArgs.includes("--save");
      await generateReflectionQuestions(db, projectId, { save });
      break;
    }

    case "questions": {
      const statusIdx = subArgs.indexOf("--status");
      const status = statusIdx >= 0 ? subArgs[statusIdx + 1] : undefined;
      await listQuestions(db, projectId, { status });
      break;
    }

    case "answer": {
      const id = parseInt(subArgs[0], 10);
      const answer = subArgs.slice(1).join(" ");
      if (Number.isNaN(id) || !answer) {
        console.error("Usage: muninn convo answer <id> \"<answer>\"");
        return;
      }
      await answerQuestion(db, id, answer);
      break;
    }

    case "dismiss": {
      const id = parseInt(subArgs[0], 10);
      if (Number.isNaN(id)) {
        console.error("Usage: muninn convo dismiss <id>");
        return;
      }
      await dismissQuestion(db, id);
      break;
    }

    default:
      console.error(`
🪞 Reflection Commands:

  muninn convo reflect [--save]
    Generate reflection questions based on analysis
    --save: Persist questions to database

  muninn convo questions [--status open|answered|dismissed]
    List reflection questions

  muninn convo answer <id> "<answer>"
    Record answer to a reflection question

  muninn convo dismiss <id>
    Dismiss a reflection question
`);
  }
}
