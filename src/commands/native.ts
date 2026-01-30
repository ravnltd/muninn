/**
 * Transformer-Native Memory Format
 *
 * Stores knowledge in a dense format optimized for LLM attention,
 * not human readability. Maximizes information per token.
 *
 * Format: K[type|ent|when|do|why|conf]
 * - type: pattern, gotcha, decision, fact, pref
 * - ent: entities/concepts involved (comma-separated)
 * - when: condition/trigger
 * - do: action to take
 * - why: reasoning (compressed)
 * - conf: confidence 0-99
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseAdapter } from "../database/adapter";
import { getApiKey } from "../utils/api-keys";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

interface NativeKnowledge {
  id: number;
  type: "pattern" | "gotcha" | "decision" | "fact" | "pref";
  entities: string[];
  condition: string | null;
  action: string | null;
  reasoning: string | null;
  confidence: number;
  embedding: Buffer | null;
  sourceId: number; // Original learning ID
  sourceTable: string; // learnings, decisions, etc.
}

// ============================================================================
// Schema
// ============================================================================

const NATIVE_SCHEMA = `
CREATE TABLE IF NOT EXISTS native_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  entities TEXT NOT NULL,
  condition TEXT,
  action TEXT,
  reasoning TEXT,
  confidence INTEGER DEFAULT 80,
  embedding BLOB,
  source_id INTEGER NOT NULL,
  source_table TEXT NOT NULL,
  native_format TEXT NOT NULL,
  original_tokens INTEGER,
  native_tokens INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_table, source_id)
);

CREATE INDEX IF NOT EXISTS idx_native_type ON native_knowledge(type);
CREATE INDEX IF NOT EXISTS idx_native_confidence ON native_knowledge(confidence);
`;

// ============================================================================
// Conversion Prompt
// ============================================================================

const CONVERSION_PROMPT = `Convert this knowledge into transformer-native format.

Rules:
- Extract TYPE: pattern (how-to), gotcha (warning), decision (choice made), fact (info), pref (preference)
- Extract ENTITIES: key concepts, files, tools (max 5, comma-separated, lowercase)
- Extract CONDITION: when this applies (short phrase or null)
- Extract ACTION: what to do (short phrase or null)
- Extract REASONING: why, compressed to <10 words
- CONFIDENCE: 0-99 based on how certain/universal this is

Input:
Title: {title}
Content: {content}
Category: {category}

Output JSON only:
{"type":"pattern","ent":["api","zod"],"when":"api endpoint","do":"validate input","why":"prevents injection","conf":90}`;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Ensure native_knowledge table exists
 */
export async function ensureNativeSchema(db: DatabaseAdapter): Promise<void> {
  const statements = NATIVE_SCHEMA.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sql of statements) {
    await db.run(sql, []);
  }
}

/**
 * Convert a learning to native format using LLM
 */
export async function convertToNative(
  title: string,
  content: string,
  category: string
): Promise<{ type: string; ent: string[]; when: string | null; do: string | null; why: string | null; conf: number }> {
  const apiKey = getApiKey("anthropic");
  if (!apiKey.ok) {
    // Fallback to heuristic conversion
    return heuristicConvert(title, content, category);
  }

  const client = new Anthropic({ apiKey: apiKey.value });

  const prompt = CONVERSION_PROMPT
    .replace("{title}", title)
    .replace("{content}", content)
    .replace("{category}", category);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return heuristicConvert(title, content, category);
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return heuristicConvert(title, content, category);
  }
}

/**
 * Heuristic conversion when API unavailable
 */
function heuristicConvert(
  title: string,
  content: string,
  category: string
): { type: string; ent: string[]; when: string | null; do: string | null; why: string | null; conf: number } {
  // Map category to type
  const typeMap: Record<string, string> = {
    pattern: "pattern",
    gotcha: "gotcha",
    preference: "pref",
    convention: "pattern",
    anti_pattern: "gotcha",
  };
  const type = typeMap[category] || "fact";

  // Extract entities from title and content
  const words = `${title} ${content}`.toLowerCase();
  const entities: string[] = [];

  // Common entity patterns
  const entityPatterns = [
    /\b(auth|authentication|login)\b/,
    /\b(api|endpoint|route)\b/,
    /\b(database|db|sql|sqlite)\b/,
    /\b(test|testing|jest|vitest)\b/,
    /\b(react|svelte|vue|angular)\b/,
    /\b(typescript|ts|javascript|js)\b/,
    /\b(validation|zod|schema)\b/,
    /\b(error|exception|handling)\b/,
    /\b(cache|redis|memory)\b/,
    /\b(docker|container|deploy)\b/,
  ];

  for (const pattern of entityPatterns) {
    const match = words.match(pattern);
    if (match && entities.length < 5) {
      entities.push(match[1]);
    }
  }

  // Extract file paths as entities
  const fileMatch = content.match(/\b[\w-]+\.(ts|js|tsx|jsx|py|go|rs)\b/g);
  if (fileMatch) {
    for (const file of fileMatch.slice(0, 2)) {
      if (entities.length < 5) entities.push(file);
    }
  }

  if (entities.length === 0) {
    entities.push("general");
  }

  // Try to extract action from content
  let action: string | null = null;
  const actionPatterns = [
    /always\s+(\w+(?:\s+\w+){0,3})/i,
    /should\s+(\w+(?:\s+\w+){0,3})/i,
    /must\s+(\w+(?:\s+\w+){0,3})/i,
    /use\s+(\w+(?:\s+\w+){0,3})/i,
  ];
  for (const pattern of actionPatterns) {
    const match = content.match(pattern);
    if (match) {
      action = match[1].slice(0, 30);
      break;
    }
  }

  // Extract condition
  let condition: string | null = null;
  const condPatterns = [
    /when\s+(\w+(?:\s+\w+){0,3})/i,
    /before\s+(\w+(?:\s+\w+){0,3})/i,
    /if\s+(\w+(?:\s+\w+){0,3})/i,
  ];
  for (const pattern of condPatterns) {
    const match = content.match(pattern);
    if (match) {
      condition = match[1].slice(0, 30);
      break;
    }
  }

  // Reasoning: first sentence or title
  const why = title.slice(0, 50);

  return { type, ent: entities, when: condition, do: action, why, conf: 70 };
}

// ============================================================================
// Decision Conversion
// ============================================================================

const DECISION_CONVERSION_PROMPT = `Convert this architectural decision into transformer-native format.

Rules:
- Extract ENTITIES: key concepts, files, tools affected (max 5, comma-separated, lowercase)
- Extract CHOICE: what was chosen (short phrase)
- Extract ALT: main alternative considered (short phrase or null)
- Extract WHY: reasoning compressed to <15 words
- CONFIDENCE: 0-99 based on how firm/reversible this decision is

Input:
Title: {title}
Decision: {decision}
Reasoning: {reasoning}

Output JSON only:
{"ent":["api","auth"],"choice":"JWT tokens","alt":"session cookies","why":"stateless, scales horizontally","conf":85}`;

interface DecisionNativeResult {
  ent: string[];
  choice: string;
  alt: string | null;
  why: string;
  conf: number;
}

/**
 * Convert a decision to native format using LLM
 */
export async function convertDecisionToNative(
  title: string,
  decision: string,
  reasoning: string | null
): Promise<DecisionNativeResult> {
  const apiKey = getApiKey("anthropic");
  if (!apiKey.ok) {
    return heuristicDecisionConvert(title, decision, reasoning);
  }

  const client = new Anthropic({ apiKey: apiKey.value });

  const prompt = DECISION_CONVERSION_PROMPT
    .replace("{title}", title)
    .replace("{decision}", decision)
    .replace("{reasoning}", reasoning || "Not specified");

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return heuristicDecisionConvert(title, decision, reasoning);
    }

    return JSON.parse(jsonMatch[0]);
  } catch {
    return heuristicDecisionConvert(title, decision, reasoning);
  }
}

/**
 * Heuristic decision conversion when API unavailable
 */
function heuristicDecisionConvert(
  title: string,
  decision: string,
  reasoning: string | null
): DecisionNativeResult {
  // Extract entities from title and decision
  const words = `${title} ${decision} ${reasoning || ""}`.toLowerCase();
  const entities: string[] = [];

  // Common entity patterns
  const entityPatterns = [
    /\b(auth|authentication|login)\b/,
    /\b(api|endpoint|route)\b/,
    /\b(database|db|sql|sqlite|postgres)\b/,
    /\b(test|testing|jest|vitest)\b/,
    /\b(react|svelte|vue|angular)\b/,
    /\b(typescript|ts|javascript|js)\b/,
    /\b(validation|zod|schema)\b/,
    /\b(cache|redis|memory)\b/,
    /\b(docker|container|deploy)\b/,
    /\b(mcp|claude|llm|ai)\b/,
  ];

  for (const pattern of entityPatterns) {
    const match = words.match(pattern);
    if (match && entities.length < 5) {
      entities.push(match[1]);
    }
  }

  if (entities.length === 0) {
    entities.push("architecture");
  }

  // Extract choice (first sentence of decision)
  const choice = decision.split(/[.!?]/)[0].slice(0, 50);

  // Extract why (first part of reasoning or title)
  const why = reasoning ? reasoning.slice(0, 50) : title.slice(0, 50);

  return { ent: entities, choice, alt: null, why, conf: 75 };
}

/**
 * Format decision as native knowledge
 */
export function formatDecisionNative(
  title: string,
  result: DecisionNativeResult
): string {
  const parts = [`D[${title.slice(0, 30)}`];

  if (result.ent.length > 0) {
    parts.push(`ent:${result.ent.join(",")}`);
  }
  parts.push(`choice:${result.choice}`);
  if (result.alt) {
    parts.push(`alt:${result.alt}`);
  }
  parts.push(`why:${result.why}`);
  parts.push(`conf:${result.conf}`);

  return `${parts.join("|")}]`;
}

/**
 * Format native knowledge for context injection
 */
export function formatNative(k: NativeKnowledge): string {
  const parts = [`K[${k.type}`];

  if (k.entities.length > 0) {
    parts.push(`ent:${k.entities.join(",")}`);
  }
  if (k.condition) {
    parts.push(`when:${k.condition}`);
  }
  if (k.action) {
    parts.push(`do:${k.action}`);
  }
  if (k.reasoning) {
    parts.push(`why:${k.reasoning}`);
  }
  parts.push(`conf:${k.confidence}`);

  return `${parts.join("|")}]`;
}

/**
 * Estimate token count (rough: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Convert learnings to native format
 */
export async function nativeConvert(
  db: DatabaseAdapter,
  projectId: number,
  options: { limit?: number; force?: boolean }
): Promise<void> {
  await ensureNativeSchema(db);

  const limit = options.limit || 50;
  const force = options.force || false;

  // Get learnings not yet converted
  let query = `
    SELECT l.id, l.title, l.content, l.category, l.embedding
    FROM learnings l
    LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
    WHERE (l.project_id = ? OR l.project_id IS NULL)
  `;

  if (!force) {
    query += " AND nk.id IS NULL";
  }
  query += ` LIMIT ?`;

  const learnings = await db.all<{
    id: number;
    title: string;
    content: string;
    category: string;
    embedding: Buffer | null;
  }>(query, [projectId, limit]);

  if (learnings.length === 0) {
    console.error("✅ All learnings already converted to native format");
    outputJson({ converted: 0, total_saved: 0 });
    return;
  }

  console.error(`\n🔄 Converting ${learnings.length} learnings to native format...\n`);

  let totalSaved = 0;
  let converted = 0;

  for (const learning of learnings) {
    try {
      const native = await convertToNative(
        learning.title,
        learning.content,
        learning.category
      );

      const nativeFormat = formatNative({
        id: 0,
        type: native.type as NativeKnowledge["type"],
        entities: native.ent,
        condition: native.when,
        action: native.do,
        reasoning: native.why,
        confidence: native.conf,
        embedding: learning.embedding,
        sourceId: learning.id,
        sourceTable: "learnings",
      });

      const originalTokens = estimateTokens(`${learning.title}\n${learning.content}`);
      const nativeTokens = estimateTokens(nativeFormat);
      const saved = originalTokens - nativeTokens;
      totalSaved += saved;

      // Upsert native knowledge
      await db.run(
        `INSERT INTO native_knowledge
         (type, entities, condition, action, reasoning, confidence, embedding, source_id, source_table, native_format, original_tokens, native_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          learning.embedding,
          learning.id,
          "learnings",
          nativeFormat,
          originalTokens,
          nativeTokens,
        ]
      );

      converted++;
      console.error(`  ✓ L${learning.id}: ${originalTokens}→${nativeTokens} tokens (saved ${saved})`);
      console.error(`    ${nativeFormat}`);
    } catch (error) {
      console.error(`  ✗ L${learning.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  console.error(`\n📊 Conversion complete:`);
  console.error(`   Converted: ${converted}/${learnings.length}`);
  console.error(`   Tokens saved: ${totalSaved}`);
  console.error(`   Avg savings: ${Math.round(totalSaved / converted)} tokens/learning`);

  outputSuccess({ converted, total_saved: totalSaved, avg_saved: Math.round(totalSaved / converted) });
}

/**
 * Show native format stats
 */
export async function nativeStats(db: DatabaseAdapter): Promise<void> {
  await ensureNativeSchema(db);

  const stats = await db.get<{
    total: number;
    original_tokens: number;
    native_tokens: number;
  }>(
    `SELECT
       COUNT(*) as total,
       COALESCE(SUM(original_tokens), 0) as original_tokens,
       COALESCE(SUM(native_tokens), 0) as native_tokens
     FROM native_knowledge`,
    []
  );

  const byType = await db.all<{ type: string; count: number }>(
    `SELECT type, COUNT(*) as count FROM native_knowledge GROUP BY type ORDER BY count DESC`,
    []
  );

  const unconverted = await db.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM learnings l
     LEFT JOIN native_knowledge nk ON nk.source_table = 'learnings' AND nk.source_id = l.id
     WHERE nk.id IS NULL`,
    []
  );

  console.error("\n📊 Native Format Statistics\n");
  console.error(`  Total converted: ${stats?.total || 0}`);
  console.error(`  Unconverted: ${unconverted?.count || 0}`);
  console.error(`  Original tokens: ${stats?.original_tokens || 0}`);
  console.error(`  Native tokens: ${stats?.native_tokens || 0}`);

  if (stats && stats.original_tokens > 0) {
    const savings = stats.original_tokens - stats.native_tokens;
    const percent = Math.round((savings / stats.original_tokens) * 100);
    console.error(`  Savings: ${savings} tokens (${percent}%)`);
  }

  if (byType.length > 0) {
    console.error("\n  By type:");
    for (const t of byType) {
      console.error(`    ${t.type}: ${t.count}`);
    }
  }

  console.error("");

  outputJson({
    total: stats?.total || 0,
    unconverted: unconverted?.count || 0,
    original_tokens: stats?.original_tokens || 0,
    native_tokens: stats?.native_tokens || 0,
    savings_percent: stats && stats.original_tokens > 0
      ? Math.round(((stats.original_tokens - stats.native_tokens) / stats.original_tokens) * 100)
      : 0,
    by_type: byType,
  });
}

/**
 * Query using native format
 */
export async function nativeQuery(
  db: DatabaseAdapter,
  query: string,
  options: { limit?: number; type?: string }
): Promise<void> {
  await ensureNativeSchema(db);

  const limit = options.limit || 10;

  let sql = `
    SELECT nk.*, l.title
    FROM native_knowledge nk
    JOIN learnings l ON nk.source_table = 'learnings' AND nk.source_id = l.id
    WHERE nk.entities LIKE ? OR nk.condition LIKE ? OR nk.action LIKE ? OR nk.reasoning LIKE ?
  `;
  const params: (string | number)[] = [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`];

  if (options.type) {
    sql += " AND nk.type = ?";
    params.push(options.type);
  }

  sql += " ORDER BY nk.confidence DESC LIMIT ?";
  params.push(limit);

  const results = await db.all<{
    id: number;
    type: string;
    entities: string;
    condition: string | null;
    action: string | null;
    reasoning: string | null;
    confidence: number;
    native_format: string;
    title: string;
  }>(sql, params);

  if (results.length === 0) {
    console.error("No native knowledge found matching query");
    outputJson({ results: [] });
    return;
  }

  console.error(`\n🧠 Native Knowledge (${results.length} results):\n`);

  for (const r of results) {
    console.error(`  ${r.native_format}`);
    console.error(`    ← ${r.title}\n`);
  }

  // Output in injectable format
  console.error("📋 Context injection format:\n");
  console.error(results.map((r) => r.native_format).join("\n"));
  console.error("");

  outputJson({ results: results.map((r) => ({ ...r, entities: JSON.parse(r.entities) })) });
}

/**
 * Export all native knowledge for context injection
 */
export async function nativeExport(
  db: DatabaseAdapter,
  options: { type?: string; minConfidence?: number }
): Promise<void> {
  await ensureNativeSchema(db);

  let sql = "SELECT native_format FROM native_knowledge WHERE 1=1";
  const params: (string | number)[] = [];

  if (options.type) {
    sql += " AND type = ?";
    params.push(options.type);
  }
  if (options.minConfidence) {
    sql += " AND confidence >= ?";
    params.push(options.minConfidence);
  }

  sql += " ORDER BY confidence DESC";

  const results = await db.all<{ native_format: string }>(sql, params);

  // Output raw native format for injection
  const output = results.map((r) => r.native_format).join("\n");
  console.log(output);
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleNativeCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[]
): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "convert":
      await nativeConvert(db, projectId, {
        limit: parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "50", 10),
        force: args.includes("--force"),
      });
      break;

    case "stats":
      await nativeStats(db);
      break;

    case "query":
      await nativeQuery(db, args[1] || "", {
        limit: parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "10", 10),
        type: args.find((a) => a.startsWith("--type="))?.split("=")[1],
      });
      break;

    case "export":
      await nativeExport(db, {
        type: args.find((a) => a.startsWith("--type="))?.split("=")[1],
        minConfidence: parseInt(args.find((a) => a.startsWith("--min-conf="))?.split("=")[1] || "0", 10),
      });
      break;

    default:
      console.error("Usage: muninn native <convert|stats|query|export>");
      console.error("");
      console.error("Commands:");
      console.error("  convert [--limit=N] [--force]  Convert learnings to native format");
      console.error("  stats                          Show conversion statistics");
      console.error("  query <text> [--type=X]        Search native knowledge");
      console.error("  export [--type=X] [--min-conf=N]  Export for context injection");
      console.error("");
      console.error("Native format: K[type|ent:x,y|when:condition|do:action|why:reason|conf:N]");
      console.error("");
      console.error("This stores knowledge in a dense format optimized for LLM attention,");
      console.error("not human readability. Typically saves 50-70% of tokens.");
  }
}
