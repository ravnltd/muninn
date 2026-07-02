/**
 * v10 Session Digest — forever memory across context compaction.
 *
 * When Claude Code compacts a long conversation, everything not in the
 * compaction summary is gone. The PreCompact hook runs this in the background:
 * parse the transcript, extract what the session was actually about (user
 * goals, files edited), and persist it to the hub so the knowledge survives
 * into future sessions — on any machine.
 */

import { readFileSync } from "node:fs";
import type { DatabaseAdapter } from "../database/adapter.js";

export interface TranscriptDigest {
  userGoals: string[];
  filesEdited: string[];
  messageCount: number;
}

// ============================================================================
// Transcript Parsing (Claude Code JSONL format, parsed defensively)
// ============================================================================

const MAX_GOALS = 6;
const GOAL_MIN_LENGTH = 20;
const GOAL_CAP = 240;

export function parseTranscript(jsonl: string): TranscriptDigest {
  const userGoals: string[] = [];
  const filesEdited = new Set<string>();
  let messageCount = 0;

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    messageCount++;

    const message = entry.message as { role?: string; content?: unknown } | undefined;
    if (!message) continue;

    if (message.role === "user" && entry.type === "user") {
      const text = extractText(message.content);
      if (isGoalLike(text)) userGoals.push(text.trim().replace(/\s+/g, " ").slice(0, GOAL_CAP));
    }

    if (message.role === "assistant") {
      for (const path of extractEditedFiles(message.content)) filesEdited.add(path);
    }
  }

  // First goal anchors the session; recent goals show where it went.
  const goals = userGoals.length <= MAX_GOALS
    ? userGoals
    : [userGoals[0] as string, ...userGoals.slice(-(MAX_GOALS - 1))];

  return { userGoals: goals, filesEdited: [...filesEdited], messageCount };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text: string } =>
      typeof c === "object" && c !== null &&
      (c as { type?: unknown }).type === "text" &&
      typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n");
}

function extractEditedFiles(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const paths: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const block = item as { type?: string; name?: string; input?: { file_path?: unknown } };
    if (block.type === "tool_use" && (block.name === "Edit" || block.name === "Write")) {
      const path = block.input?.file_path;
      if (typeof path === "string") paths.push(path);
    }
  }
  return paths;
}

/** Real requests, not bare confirmations, slash commands, or hook noise. */
function isGoalLike(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length >= GOAL_MIN_LENGTH &&
    !trimmed.startsWith("/") &&
    !trimmed.startsWith("<") &&
    !trimmed.startsWith("[")
  );
}

// ============================================================================
// Digest Composition + Persistence
// ============================================================================

export function composeDigest(digest: TranscriptDigest): string {
  const lines: string[] = [];
  if (digest.userGoals.length > 0) {
    lines.push("Compaction digest — what this session was about:");
    for (const goal of digest.userGoals) lines.push(`- ${goal}`);
  }
  if (digest.filesEdited.length > 0) {
    lines.push(`Files edited: ${digest.filesEdited.slice(0, 20).join(", ")}`);
  }
  return lines.join("\n");
}

/** Persist a transcript digest onto the active session (called by `muninn session digest`). */
export async function digestTranscript(
  db: DatabaseAdapter,
  projectId: number,
  transcriptPath: string,
): Promise<{ saved: boolean; goals: number; files: number }> {
  const digest = parseTranscript(readFileSync(transcriptPath, "utf-8"));
  const text = composeDigest(digest);
  if (!text) return { saved: false, goals: 0, files: 0 };

  const session = await db.get<{ id: number; learnings: string | null; files_touched: string | null }>(
    `SELECT id, learnings, files_touched FROM sessions
     WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [projectId],
  );
  if (!session) return { saved: false, goals: digest.userGoals.length, files: digest.filesEdited.length };

  const mergedFiles = mergeFiles(session.files_touched, digest.filesEdited);
  const learnings = session.learnings ? `${session.learnings}\n\n${text}` : text;

  await db.run(
    `UPDATE sessions SET learnings = ?, files_touched = ? WHERE id = ?`,
    [learnings, JSON.stringify(mergedFiles), session.id],
  );
  return { saved: true, goals: digest.userGoals.length, files: digest.filesEdited.length };
}

function mergeFiles(existing: string | null, added: string[]): string[] {
  const merged = new Set<string>(added);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (Array.isArray(parsed)) for (const p of parsed) if (typeof p === "string") merged.add(p);
    } catch {
      // Ignore malformed history
    }
  }
  return [...merged];
}
