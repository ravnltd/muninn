/**
 * Conversation History Import
 * Import and manage ChatGPT/Claude conversation exports
 */

import { readFileSync } from "node:fs";
import type { DatabaseAdapter } from "../database/adapter";
import type { Conversation, ConversationMessage, ConversationSource } from "../types";
import { outputJson, outputError } from "../utils/format";
import { handleExtractionCommand } from "./extraction";
import { handleAnalysisCommand } from "./conversation-analysis";
import { handleReflectionCommand } from "./reflection";
import { handleProfileSynthesisCommand } from "./profile-synthesis";
import { escapeFtsQuery } from "../database/queries/search";

// ============================================================================
// Types
// ============================================================================

interface ParsedConversation {
  externalId: string;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  model: string | null;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: string | null;
    model: string | null;
  }>;
}

// ============================================================================
// Format Detection
// ============================================================================

function detectFormat(data: unknown): ConversationSource | "unknown" {
  if (!Array.isArray(data) || data.length === 0) return "unknown";

  // Claude: has uuid and chat_messages
  if (data[0]?.uuid && data[0]?.chat_messages) return "claude";

  // ChatGPT: has mapping object
  if (data[0]?.mapping) return "chatgpt";

  return "unknown";
}

// ============================================================================
// ChatGPT Parser
// ============================================================================

function parseChatGPTExport(data: unknown[]): ParsedConversation[] {
  return (data as Record<string, unknown>[]).map((conv) => {
    const mapping = conv.mapping as Record<string, unknown> | undefined;
    const messages = mapping ? extractChatGPTMessages(mapping) : [];
    const timestamps = messages
      .filter((m): m is typeof m & { timestamp: number } => !!m.timestamp)
      .map((m) => m.timestamp);

    const createTime = conv.create_time as number | undefined;
    const updateTime = conv.update_time as number | undefined;

    return {
      externalId: (conv.id as string) ?? `chatgpt-${createTime}`,
      title: (conv.title as string) || null,
      startedAt:
        timestamps[0] || (createTime ? new Date(createTime * 1000).toISOString() : null),
      endedAt:
        timestamps[timestamps.length - 1] ||
        (updateTime ? new Date(updateTime * 1000).toISOString() : null),
      model: messages.find((m) => m.model)?.model || null,
      messages,
    };
  });
}

function extractChatGPTMessages(
  mapping: Record<string, unknown>
): ParsedConversation["messages"] {
  const messages: ParsedConversation["messages"] = [];

  // Build parent-child map and find root
  const nodes = Object.values(mapping) as Array<{
    id: string;
    message?: {
      author: { role: string };
      content: { parts?: string[] };
      create_time?: number;
      metadata?: { model_slug?: string };
    };
    parent?: string;
    children?: string[];
  }>;

  const childIds = new Set(nodes.flatMap((n) => n.children || []));
  const roots = nodes.filter((n) => !childIds.has(n.id));

  // DFS to get messages in order
  function traverse(nodeId: string) {
    const node = mapping[nodeId] as (typeof nodes)[0] | undefined;
    if (!node) return;

    if (node.message?.content?.parts?.[0]) {
      const role = node.message.author.role;
      if (role === "user" || role === "assistant") {
        messages.push({
          role: role as "user" | "assistant",
          content: node.message.content.parts[0],
          timestamp: node.message.create_time
            ? new Date(node.message.create_time * 1000).toISOString()
            : null,
          model: node.message.metadata?.model_slug || null,
        });
      }
    }

    for (const childId of node.children || []) {
      traverse(childId);
    }
  }

  for (const root of roots) {
    traverse(root.id);
  }

  return messages;
}

// ============================================================================
// Claude Parser
// ============================================================================

interface ClaudeContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "token_budget";
  text?: string;
  thinking?: string;
  name?: string;
  input?: {
    id?: string;
    type?: string;
    title?: string;
    content?: string;
  };
  content?: string;
}

interface ClaudeMessage {
  uuid: string;
  sender: "human" | "assistant";
  text: string;
  content?: ClaudeContentBlock[];
  created_at: string;
}

interface ClaudeConversation {
  uuid: string;
  name?: string;
  created_at: string;
  updated_at: string;
  chat_messages: ClaudeMessage[];
}

/**
 * Extract full content from Claude message including thinking blocks and artifacts.
 * Format:
 * - Main text first
 * - Thinking blocks appended with [THINKING] prefix
 * - Artifacts summarized with [ARTIFACT:type:title] prefix
 */
function extractClaudeMessageContent(msg: ClaudeMessage): string {
  const parts: string[] = [];

  // 1. Main text content
  if (msg.text) {
    parts.push(msg.text);
  }

  // 2. Process content blocks for additional context
  if (msg.content && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      // Thinking blocks - Claude's internal reasoning (very valuable for extraction)
      if (block.type === "thinking" && block.thinking) {
        parts.push(`\n[THINKING]\n${block.thinking}\n[/THINKING]`);
      }

      // Artifacts - summarize with metadata (full content is too verbose)
      if (block.type === "tool_use" && block.name === "artifacts" && block.input) {
        const { type, title, content } = block.input;
        if (content) {
          // Include first 500 chars of artifact for context
          const preview = content.length > 500 ? `${content.slice(0, 500)}...` : content;
          parts.push(`\n[ARTIFACT:${type || "unknown"}:${title || "untitled"}]\n${preview}\n[/ARTIFACT]`);
        }
      }
    }
  }

  return parts.join("");
}

function parseClaudeExport(data: unknown[]): ParsedConversation[] {
  return (data as ClaudeConversation[]).map((conv) => ({
    externalId: conv.uuid,
    title: conv.name || null,
    startedAt: conv.created_at,
    endedAt: conv.updated_at,
    model: null, // Claude export doesn't include model info
    messages: conv.chat_messages.map((msg) => ({
      role: (msg.sender === "human" ? "user" : "assistant") as "user" | "assistant",
      content: extractClaudeMessageContent(msg),
      timestamp: msg.created_at,
      model: null,
    })),
  }));
}

// ============================================================================
// Database Operations
// ============================================================================

async function insertConversation(
  db: DatabaseAdapter,
  source: ConversationSource,
  conv: ParsedConversation
): Promise<number> {
  const userCount = conv.messages.filter((m) => m.role === "user").length;
  const assistantCount = conv.messages.filter((m) => m.role === "assistant").length;
  const totalChars = conv.messages.reduce((sum, m) => sum + m.content.length, 0);

  const result = await db.run(
    `
    INSERT INTO conversations (
      source, external_id, title, started_at, ended_at, participant_model,
      message_count, user_message_count, assistant_message_count, total_chars
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      source,
      conv.externalId,
      conv.title,
      conv.startedAt,
      conv.endedAt,
      conv.model,
      conv.messages.length,
      userCount,
      assistantCount,
      totalChars,
    ]
  );

  const conversationId = Number(result.lastInsertRowid);

  // Insert messages
  for (let i = 0; i < conv.messages.length; i++) {
    const msg = conv.messages[i];
    await db.run(
      `
      INSERT INTO conversation_messages (
        conversation_id, role, content, message_index, timestamp, model, char_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [conversationId, msg.role, msg.content, i, msg.timestamp, msg.model, msg.content.length]
    );
  }

  return conversationId;
}

// ============================================================================
// Import Function
// ============================================================================

export async function importConversations(
  db: DatabaseAdapter,
  filePath: string,
  options: { source?: ConversationSource; force?: boolean }
): Promise<void> {
  // 1. Read and parse file
  const raw = readFileSync(filePath, "utf-8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    outputError("Invalid JSON file");
    return;
  }

  // 2. Detect format
  const source = options.source ?? detectFormat(data);
  if (source === "unknown") {
    outputError("Could not detect export format. Use --source chatgpt or --source claude");
    return;
  }

  // 3. If force, delete existing conversations from this source
  if (options.force) {
    console.error(`🗑️  Deleting existing ${source} conversations...`);
    await db.run("DELETE FROM conversations WHERE source = ?", [source]);
    console.error(`   Done.\n`);
  }

  // 4. Parse based on format
  const conversations =
    source === "chatgpt"
      ? parseChatGPTExport(data as unknown[])
      : parseClaudeExport(data as unknown[]);

  // 5. Import each conversation
  let imported = 0;
  let skipped = 0;
  const updated = 0;

  for (const conv of conversations) {
    const existing = await db.get<{ id: number }>(
      "SELECT id FROM conversations WHERE source = ? AND external_id = ?",
      [source, conv.externalId]
    );

    if (existing) {
      skipped++;
      continue;
    }

    await insertConversation(db, source, conv);
    imported++;

    // Progress indicator every 100
    if (imported % 100 === 0) {
      console.error(`   Imported ${imported}...`);
    }
  }

  console.error(`\n✅ Import complete: ${imported} imported, ${skipped} skipped (duplicates)\n`);
  outputJson({ imported, skipped, updated, source });
}

// ============================================================================
// Query Functions
// ============================================================================

export async function listConversations(
  db: DatabaseAdapter,
  options: { source?: ConversationSource; limit?: number }
): Promise<void> {
  const limit = options.limit ?? 20;
  let sql = `
    SELECT id, source, title, started_at, message_count,
           user_message_count, assistant_message_count, total_chars
    FROM conversations
  `;
  const params: unknown[] = [];

  if (options.source) {
    sql += " WHERE source = ?";
    params.push(options.source);
  }

  sql += " ORDER BY started_at DESC LIMIT ?";
  params.push(limit);

  const conversations = await db.all<Conversation>(sql, params);

  console.error(`\n📜 Conversations (${conversations.length}):\n`);
  for (const c of conversations) {
    const title = c.title || "(untitled)";
    const date = c.started_at ? new Date(c.started_at).toLocaleDateString() : "unknown";
    console.error(`  #${c.id} [${c.source}] ${title}`);
    console.error(
      `      ${date} · ${c.message_count} messages · ${Math.round(c.total_chars / 1000)}k chars`
    );
  }
  console.error("");

  outputJson(conversations);
}

export async function showConversation(
  db: DatabaseAdapter,
  id: number,
  options: { full?: boolean }
): Promise<void> {
  const conv = await db.get<Conversation>("SELECT * FROM conversations WHERE id = ?", [id]);

  if (!conv) {
    outputError(`Conversation #${id} not found`);
    return;
  }

  const messages = await db.all<ConversationMessage>(
    "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY message_index",
    [id]
  );

  console.error(`\n📜 Conversation #${conv.id}: ${conv.title || "(untitled)"}\n`);
  console.error(`  Source: ${conv.source}`);
  console.error(`  Started: ${conv.started_at || "unknown"}`);
  console.error(
    `  Messages: ${conv.message_count} (${conv.user_message_count} user, ${conv.assistant_message_count} assistant)`
  );
  console.error(`  Size: ${Math.round(conv.total_chars / 1000)}k chars`);
  console.error("");

  if (options.full) {
    console.error("─".repeat(60));
    for (const msg of messages) {
      const prefix = msg.role === "user" ? "👤 User" : "🤖 Assistant";
      console.error(`\n${prefix}:`);
      console.error(msg.content.slice(0, 500) + (msg.content.length > 500 ? "..." : ""));
    }
    console.error(`\n${"─".repeat(60)}`);
  }

  outputJson({ conversation: conv, messages: options.full ? messages : undefined });
}

export async function searchConversations(
  db: DatabaseAdapter,
  query: string,
  options: { limit?: number }
): Promise<void> {
  const limit = options.limit ?? 10;
  const safeQuery = escapeFtsQuery(query);

  if (!safeQuery || safeQuery === '""') {
    outputError("Invalid search query");
    outputJson([]);
    return;
  }

  const results = await db.all<{
    id: number;
    conversation_id: number;
    content: string;
    role: string;
  }>(
    `
    SELECT cm.id, cm.conversation_id, cm.content, cm.role
    FROM fts_conversation_messages fts
    JOIN conversation_messages cm ON fts.rowid = cm.id
    WHERE fts_conversation_messages MATCH ?
    LIMIT ?
  `,
    [safeQuery, limit]
  );

  console.error(`\n🔍 Search results for "${query}" (${results.length}):\n`);

  for (const r of results) {
    const conv = await db.get<{ title: string }>(
      "SELECT title FROM conversations WHERE id = ?",
      [r.conversation_id]
    );
    console.error(`  Conversation #${r.conversation_id}: ${conv?.title || "(untitled)"}`);
    console.error(`  [${r.role}] ${r.content.slice(0, 100)}...`);
    console.error("");
  }

  outputJson(results);
}

export async function getConversationStats(db: DatabaseAdapter): Promise<void> {
  const stats = await db.get<{
    total: number;
    chatgpt_count: number;
    claude_count: number;
    total_messages: number;
    total_chars: number;
  }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN source = 'chatgpt' THEN 1 ELSE 0 END) as chatgpt_count,
      SUM(CASE WHEN source = 'claude' THEN 1 ELSE 0 END) as claude_count,
      SUM(message_count) as total_messages,
      SUM(total_chars) as total_chars
    FROM conversations
  `);

  console.error("\n📊 Conversation Statistics:\n");
  console.error(`  Total conversations: ${stats?.total || 0}`);
  console.error(`    ChatGPT: ${stats?.chatgpt_count || 0}`);
  console.error(`    Claude: ${stats?.claude_count || 0}`);
  console.error(`  Total messages: ${stats?.total_messages || 0}`);
  console.error(`  Total size: ${Math.round((stats?.total_chars || 0) / 1000)}k chars`);
  console.error("");

  outputJson(stats);
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleConversationsCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[]
): Promise<void> {
  const subCmd = args[0];
  const subArgs = args.slice(1);

  switch (subCmd) {
    // Extraction commands delegate to extraction.ts
    case "extract":
    case "extracts":
      await handleExtractionCommand(db, projectId, args);
      return;

    // Analysis commands delegate to conversation-analysis.ts
    case "analyze":
      await handleAnalysisCommand(db, projectId, subArgs);
      return;

    // Reflection commands delegate to reflection.ts
    case "reflect":
    case "questions":
    case "answer":
    case "dismiss":
      await handleReflectionCommand(db, projectId, args);
      return;

    // Profile synthesis
    case "profile":
      await handleProfileSynthesisCommand(db, projectId, subArgs);
      return;
    case "import": {
      const filePath = subArgs.find((a) => !a.startsWith("--"));
      if (!filePath) {
        console.error("Usage: muninn convo import <file> [--source chatgpt|claude] [--force]");
        return;
      }
      const sourceIdx = subArgs.indexOf("--source");
      const source =
        sourceIdx >= 0 ? (subArgs[sourceIdx + 1] as ConversationSource) : undefined;
      const force = subArgs.includes("--force");
      await importConversations(db, filePath, { source, force });
      break;
    }

    case "list": {
      const sourceIdx = subArgs.indexOf("--source");
      const source =
        sourceIdx >= 0 ? (subArgs[sourceIdx + 1] as ConversationSource) : undefined;
      const limitIdx = subArgs.indexOf("--limit");
      const limit = limitIdx >= 0 ? parseInt(subArgs[limitIdx + 1], 10) : undefined;
      await listConversations(db, { source, limit });
      break;
    }

    case "show": {
      const id = parseInt(subArgs[0], 10);
      if (Number.isNaN(id)) {
        console.error("Usage: muninn convo show <id> [--full]");
        return;
      }
      const full = subArgs.includes("--full");
      await showConversation(db, id, { full });
      break;
    }

    case "search": {
      const query = subArgs.filter((a) => !a.startsWith("--")).join(" ");
      if (!query) {
        console.error("Usage: muninn convo search <query> [--limit N]");
        return;
      }
      const limitIdx = subArgs.indexOf("--limit");
      const limit = limitIdx >= 0 ? parseInt(subArgs[limitIdx + 1], 10) : undefined;
      await searchConversations(db, query, { limit });
      break;
    }

    case "stats": {
      await getConversationStats(db);
      break;
    }

    default:
      console.error(`
📜 Conversation History Commands:

  muninn convo import <file> [--source chatgpt|claude] [--force]
    Import conversations from ChatGPT or Claude export
    --force: Delete existing conversations from source before importing

  muninn convo list [--source chatgpt|claude] [--limit N]
    List imported conversations

  muninn convo show <id> [--full]
    Show conversation details (--full for messages)

  muninn convo search <query> [--limit N]
    Search message content

  muninn convo stats
    Show import statistics

🧠 Extraction Commands:

  muninn convo extract <id> [--dry-run] [--force]
    Extract knowledge from a single conversation

  muninn convo extract --all [--limit N] [--dry-run]
    Extract from all pending conversations (default limit: 10)

  muninn convo extracts <id>
    Show what was extracted from a conversation

🔬 Analysis Commands:

  muninn convo analyze [--patterns] [--contradictions]
    Detect patterns and contradictions in extracted knowledge

🪞 Reflection Commands:

  muninn convo reflect [--save]
    Generate reflection questions based on analysis

  muninn convo questions [--status open|answered|dismissed]
    List reflection questions

  muninn convo answer <id> "<answer>"
    Record answer to a reflection question

  muninn convo dismiss <id>
    Dismiss a reflection question

📊 Profile Commands:

  muninn convo profile [--json]
    Show synthesized developer profile from conversations
`);
  }
}
