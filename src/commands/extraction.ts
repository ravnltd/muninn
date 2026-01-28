/**
 * Conversation Knowledge Extraction
 * Extract decisions, learnings, issues, and preferences from imported conversations
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseAdapter } from "../database/adapter";
import type {
  Conversation,
  ConversationMessage,
  ExtractionResult,
  ExtractEntityType,
} from "../types";
import { outputJson, outputError } from "../utils/format";

// ============================================================================
// Configuration
// ============================================================================

const CONFIDENCE_THRESHOLD = 0.8;
const DEFAULT_RATE_LIMIT = 10;
const MAX_TOKENS_PER_CHUNK = 12000; // ~3k words, safe for Haiku
const CHARS_PER_TOKEN_ESTIMATE = 4;

// ============================================================================
// Compression System
// ============================================================================

/**
 * Compress conversation content using an ultra-dense notation.
 * Preserves semantic meaning while drastically reducing token count.
 *
 * Legend:
 * U: → User message
 * A: → Assistant message
 * [T] → Thinking block summary
 * [D] → Decision made
 * [L] → Learning/insight
 * [I] → Issue discussed
 * [P] → Preference expressed
 */
function compressConversation(messages: ConversationMessage[]): string {
  const compressed: string[] = [];

  for (const msg of messages) {
    const prefix = msg.role === "user" ? "U:" : "A:";
    let content = msg.content;

    // Extract and compress thinking blocks
    const thinkingMatch = content.match(/\[THINKING\]([\s\S]*?)\[\/THINKING\]/g);
    if (thinkingMatch) {
      // Summarize thinking to key points
      for (const block of thinkingMatch) {
        const thinking = block.replace(/\[\/THINKING\]|\[THINKING\]/g, "").trim();
        // Keep first 200 chars of thinking as summary
        const summary = thinking.slice(0, 200).replace(/\n/g, " ");
        content = content.replace(block, `[T]${summary}...`);
      }
    }

    // Compress artifact blocks
    content = content.replace(
      /\[ARTIFACT:(.*?):(.*?)\][\s\S]*?\[\/ARTIFACT\]/g,
      "[ART:$1:$2]"
    );

    // Remove excessive whitespace
    content = content.replace(/\n{3,}/g, "\n\n").trim();

    // Skip empty messages
    if (!content) continue;

    compressed.push(`${prefix} ${content}`);
  }

  return compressed.join("\n---\n");
}

/**
 * Chunk conversation into segments that fit context window
 */
function chunkConversation(
  messages: ConversationMessage[]
): ConversationMessage[][] {
  const chunks: ConversationMessage[][] = [];
  let currentChunk: ConversationMessage[] = [];
  let currentSize = 0;

  for (const msg of messages) {
    const msgSize = msg.content.length / CHARS_PER_TOKEN_ESTIMATE;

    if (currentSize + msgSize > MAX_TOKENS_PER_CHUNK && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(msg);
    currentSize += msgSize;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// ============================================================================
// LLM Extraction
// ============================================================================

const EXTRACTION_PROMPT = `You are analyzing a conversation to extract structured knowledge.

IMPORTANT: Only extract HIGH-CONFIDENCE insights (confidence >= 0.8). Skip anything ambiguous or trivial.

Extract into these categories:

1. DECISIONS - Architectural, technology, or design choices made
   - Must be explicit decisions, not just discussion
   - Include the reasoning if available

2. LEARNINGS - Patterns, gotchas, insights discovered
   - Technical patterns that worked
   - Gotchas/pitfalls to avoid
   - Preferences about tools/approaches
   - Conventions established

3. ISSUES - Bugs, problems discussed and how they were resolved
   - Only include if there's a clear problem statement
   - Include resolution if available

4. PREFERENCES - Explicit user preferences about coding style, tools, etc.
   - Must be explicitly stated, not inferred

5. PROJECTS - Project names mentioned (for linking)

Return ONLY valid JSON in this exact format:
{
  "decisions": [
    { "title": "...", "decision": "...", "reasoning": "...", "confidence": 0.9, "excerpt": "..." }
  ],
  "learnings": [
    { "title": "...", "content": "...", "category": "pattern|gotcha|preference|convention", "confidence": 0.85, "excerpt": "..." }
  ],
  "issues": [
    { "title": "...", "description": "...", "resolution": "...", "confidence": 0.8, "excerpt": "..." }
  ],
  "preferences": [
    { "key": "...", "value": "...", "confidence": 0.9, "excerpt": "..." }
  ],
  "projects_mentioned": ["project1", "project2"]
}

If nothing meets the confidence threshold, return empty arrays.
Be concise in titles and excerpts.`;

async function extractWithLLM(
  conversationContent: string,
  title: string | null
): Promise<ExtractionResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("⚠️  ANTHROPIC_API_KEY not set, skipping extraction");
    return null;
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Conversation title: "${title || "Untitled"}"\n\n${conversationContent}`,
        },
      ],
      system: EXTRACTION_PROMPT,
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("⚠️  No valid JSON in response");
      return null;
    }

    return JSON.parse(jsonMatch[0]) as ExtractionResult;
  } catch (error) {
    console.error(`⚠️  Extraction error: ${error}`);
    return null;
  }
}

// ============================================================================
// Database Storage
// ============================================================================

async function storeExtractionResults(
  db: DatabaseAdapter,
  conversationId: number,
  projectId: number,
  results: ExtractionResult
): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;

  // Store decisions
  for (const d of results.decisions) {
    if (d.confidence < CONFIDENCE_THRESHOLD) {
      skipped++;
      continue;
    }

    const result = await db.run(
      `INSERT INTO decisions (project_id, title, decision, reasoning, status, decided_at)
       VALUES (?, ?, ?, ?, 'active', datetime('now'))`,
      [projectId, d.title, d.decision, d.reasoning]
    );

    await db.run(
      `INSERT INTO conversation_extracts (conversation_id, entity_type, entity_id, confidence, excerpt)
       VALUES (?, 'decision', ?, ?, ?)`,
      [conversationId, Number(result.lastInsertRowid), d.confidence, d.excerpt || null]
    );
    stored++;
  }

  // Store learnings
  for (const l of results.learnings) {
    if (l.confidence < CONFIDENCE_THRESHOLD) {
      skipped++;
      continue;
    }

    const result = await db.run(
      `INSERT INTO learnings (project_id, title, content, category, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [projectId, l.title, l.content, l.category]
    );

    await db.run(
      `INSERT INTO conversation_extracts (conversation_id, entity_type, entity_id, confidence, excerpt)
       VALUES (?, 'learning', ?, ?, ?)`,
      [conversationId, Number(result.lastInsertRowid), l.confidence, l.excerpt || null]
    );
    stored++;
  }

  // Store issues (as resolved since they're from historical conversations)
  for (const i of results.issues) {
    if (i.confidence < CONFIDENCE_THRESHOLD) {
      skipped++;
      continue;
    }

    const result = await db.run(
      `INSERT INTO issues (project_id, title, description, type, severity, status, resolution, created_at, resolved_at)
       VALUES (?, ?, ?, 'historical', 5, 'resolved', ?, datetime('now'), datetime('now'))`,
      [projectId, i.title, i.description, i.resolution || null]
    );

    await db.run(
      `INSERT INTO conversation_extracts (conversation_id, entity_type, entity_id, confidence, excerpt)
       VALUES (?, 'issue', ?, ?, ?)`,
      [conversationId, Number(result.lastInsertRowid), i.confidence, i.excerpt || null]
    );
    stored++;
  }

  // Store preferences in developer_profile
  for (const p of results.preferences) {
    if (p.confidence < CONFIDENCE_THRESHOLD) {
      skipped++;
      continue;
    }

    // Upsert preference (unique constraint is on project_id, key)
    await db.run(
      `INSERT INTO developer_profile (project_id, category, key, value, confidence, source, created_at)
       VALUES (?, 'preference', ?, ?, ?, 'conversation', datetime('now'))
       ON CONFLICT(project_id, key) DO UPDATE SET
         value = excluded.value,
         confidence = MAX(confidence, excluded.confidence)`,
      [projectId, p.key, p.value, p.confidence]
    );

    // We don't track individual preferences in conversation_extracts
    // since they're aggregated in developer_profile
    stored++;
  }

  return { stored, skipped };
}

// ============================================================================
// Main Extraction Functions
// ============================================================================

export async function extractConversation(
  db: DatabaseAdapter,
  projectId: number,
  conversationId: number,
  options: { dryRun?: boolean; force?: boolean }
): Promise<void> {
  // Get conversation
  const conv = await db.get<Conversation>(
    "SELECT * FROM conversations WHERE id = ?",
    [conversationId]
  );

  if (!conv) {
    outputError(`Conversation #${conversationId} not found`);
    return;
  }

  // Check if already extracted (unless force)
  if (conv.extraction_status === "extracted" && !options.force) {
    console.error(`⏭️  Conversation #${conversationId} already extracted (use --force to re-extract)`);
    return;
  }

  // Get messages
  const messages = await db.all<ConversationMessage>(
    "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY message_index",
    [conversationId]
  );

  if (messages.length === 0) {
    console.error(`⏭️  Conversation #${conversationId} has no messages`);
    await db.run(
      "UPDATE conversations SET extraction_status = 'skipped' WHERE id = ?",
      [conversationId]
    );
    return;
  }

  console.error(`\n🔍 Extracting from: ${conv.title || "(untitled)"}`);
  console.error(`   Messages: ${messages.length}, Size: ${Math.round(conv.total_chars / 1000)}k chars`);

  // Chunk if needed
  const chunks = chunkConversation(messages);
  console.error(`   Chunks: ${chunks.length}`);

  // Process each chunk
  const allResults: ExtractionResult = {
    decisions: [],
    learnings: [],
    issues: [],
    preferences: [],
    projects_mentioned: [],
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const compressed = compressConversation(chunk);

    if (options.dryRun) {
      console.error(`\n--- Chunk ${i + 1}/${chunks.length} (${compressed.length} chars) ---`);
      console.error(`${compressed.slice(0, 500)}...`);
      continue;
    }

    console.error(`   Processing chunk ${i + 1}/${chunks.length}...`);
    const results = await extractWithLLM(compressed, conv.title);

    if (results) {
      allResults.decisions.push(...results.decisions);
      allResults.learnings.push(...results.learnings);
      allResults.issues.push(...results.issues);
      allResults.preferences.push(...results.preferences);
      allResults.projects_mentioned.push(...results.projects_mentioned);
    }
  }

  if (options.dryRun) {
    console.error("\n--- Dry run complete ---");
    return;
  }

  // Dedupe projects mentioned
  allResults.projects_mentioned = [...new Set(allResults.projects_mentioned)];

  // Store results
  const { stored, skipped } = await storeExtractionResults(
    db,
    conversationId,
    projectId,
    allResults
  );

  // Update extraction status
  await db.run(
    "UPDATE conversations SET extraction_status = 'extracted', project_id = ? WHERE id = ?",
    [projectId, conversationId]
  );

  console.error(`   ✅ Stored: ${stored} entities, Skipped: ${skipped} (below threshold)`);
  console.error(
    `      Decisions: ${allResults.decisions.filter((d) => d.confidence >= CONFIDENCE_THRESHOLD).length}`
  );
  console.error(
    `      Learnings: ${allResults.learnings.filter((l) => l.confidence >= CONFIDENCE_THRESHOLD).length}`
  );
  console.error(
    `      Issues: ${allResults.issues.filter((i) => i.confidence >= CONFIDENCE_THRESHOLD).length}`
  );
  console.error(
    `      Preferences: ${allResults.preferences.filter((p) => p.confidence >= CONFIDENCE_THRESHOLD).length}`
  );

  outputJson({
    conversationId,
    stored,
    skipped,
    decisions: allResults.decisions.length,
    learnings: allResults.learnings.length,
    issues: allResults.issues.length,
    preferences: allResults.preferences.length,
    projects: allResults.projects_mentioned,
  });
}

export async function extractAll(
  db: DatabaseAdapter,
  projectId: number,
  options: { limit?: number; dryRun?: boolean }
): Promise<void> {
  const limit = options.limit ?? DEFAULT_RATE_LIMIT;

  // Get pending conversations (non-empty, not yet extracted)
  const pending = await db.all<Conversation>(
    `SELECT * FROM conversations
     WHERE extraction_status = 'pending' AND total_chars > 0
     ORDER BY started_at DESC
     LIMIT ?`,
    [limit]
  );

  if (pending.length === 0) {
    console.error("✅ No pending conversations to extract");
    return;
  }

  console.error(`\n📚 Extracting ${pending.length} conversations...\n`);

  for (let i = 0; i < pending.length; i++) {
    const conv = pending[i];
    console.error(`[${i + 1}/${pending.length}] #${conv.id}: ${conv.title || "(untitled)"}`);

    await extractConversation(db, projectId, conv.id, options);
  }

  console.error(`\n✅ Extraction complete`);
}

export async function showExtracts(
  db: DatabaseAdapter,
  conversationId: number
): Promise<void> {
  const conv = await db.get<Conversation>(
    "SELECT * FROM conversations WHERE id = ?",
    [conversationId]
  );

  if (!conv) {
    outputError(`Conversation #${conversationId} not found`);
    return;
  }

  const extracts = await db.all<{
    id: number;
    entity_type: ExtractEntityType;
    entity_id: number;
    confidence: number;
    excerpt: string | null;
  }>(
    "SELECT * FROM conversation_extracts WHERE conversation_id = ? ORDER BY entity_type",
    [conversationId]
  );

  console.error(`\n📜 Extracts from: ${conv.title || "(untitled)"}`);
  console.error(`   Status: ${conv.extraction_status}\n`);

  if (extracts.length === 0) {
    console.error("   No extracts found.");
    return;
  }

  const byType: Record<string, typeof extracts> = {};
  for (const e of extracts) {
    if (!byType[e.entity_type]) byType[e.entity_type] = [];
    byType[e.entity_type].push(e);
  }

  for (const [type, items] of Object.entries(byType)) {
    console.error(`   ${type.toUpperCase()}S (${items.length}):`);
    for (const item of items) {
      console.error(`     - #${item.entity_id} (${Math.round(item.confidence * 100)}%)`);
      if (item.excerpt) {
        console.error(`       "${item.excerpt.slice(0, 80)}..."`);
      }
    }
  }

  outputJson({ conversation: conv, extracts });
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleExtractionCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[]
): Promise<void> {
  const subCmd = args[0];
  const subArgs = args.slice(1);

  switch (subCmd) {
    case "extract": {
      const idArg = subArgs.find((a) => !a.startsWith("--"));
      const dryRun = subArgs.includes("--dry-run");
      const force = subArgs.includes("--force");
      const all = subArgs.includes("--all");
      const limitIdx = subArgs.indexOf("--limit");
      const limit = limitIdx >= 0 ? parseInt(subArgs[limitIdx + 1], 10) : undefined;

      if (all) {
        await extractAll(db, projectId, { limit, dryRun });
      } else if (idArg) {
        const id = parseInt(idArg, 10);
        if (Number.isNaN(id)) {
          console.error("Usage: muninn convo extract <id> [--dry-run] [--force]");
          return;
        }
        await extractConversation(db, projectId, id, { dryRun, force });
      } else {
        console.error("Usage: muninn convo extract <id|--all> [--limit N] [--dry-run] [--force]");
      }
      break;
    }

    case "extracts": {
      const id = parseInt(subArgs[0], 10);
      if (Number.isNaN(id)) {
        console.error("Usage: muninn convo extracts <id>");
        return;
      }
      await showExtracts(db, id);
      break;
    }

    default:
      console.error(`
🧠 Conversation Extraction Commands:

  muninn convo extract <id> [--dry-run] [--force]
    Extract knowledge from a single conversation
    --dry-run: Show what would be extracted without calling LLM
    --force: Re-extract even if already processed

  muninn convo extract --all [--limit N] [--dry-run]
    Extract from all pending conversations
    --limit: Max conversations to process (default: 10)

  muninn convo extracts <id>
    Show what was extracted from a conversation
`);
  }
}
