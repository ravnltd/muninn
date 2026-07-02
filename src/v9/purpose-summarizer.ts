/**
 * v10 Purpose Summarizer — LLM-written one-line file purposes.
 *
 * The prompt map (exploration replacement) is only as good as `files.purpose`.
 * The structural capture path infers purposes from regex-extracted export
 * names, which produces junk like "Exports: foo, bar". This worker job reads
 * the head of each such file and asks a small model for a real one-sentence
 * purpose, in batches.
 *
 * Cost control: capped batches per run, content truncated to the file head,
 * files re-summarized only while their purpose is missing or junk. No API
 * key configured = silent no-op.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseAdapter } from "../database/adapter.js";
import { getApiKey } from "../utils/api-keys.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("purpose-summarizer");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 10;
const MAX_BATCHES_PER_RUN = 5;
const HEAD_LINES = 60;
const MAX_FILE_BYTES = 100_000;
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|swift|kt|svelte|vue|sh|sql)$/;

interface PurposeCandidate {
  path: string;
  head: string;
}

export interface SummarizeResult {
  updated: number;
  candidates: number;
  skipped: string | null;
}

// ============================================================================
// Main Entry — called from the worker
// ============================================================================

export async function summarizePurposes(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
): Promise<SummarizeResult> {
  const keyResult = getApiKey("anthropic");
  if (!keyResult.ok) {
    return { updated: 0, candidates: 0, skipped: "no anthropic API key" };
  }

  const candidates = await findPurposeCandidates(db, projectId, projectPath);
  if (candidates.length === 0) {
    return { updated: 0, candidates: 0, skipped: null };
  }

  let updated = 0;
  const batches = chunk(candidates, BATCH_SIZE).slice(0, MAX_BATCHES_PER_RUN);
  for (const batch of batches) {
    const purposes = await summarizeBatch(keyResult.value, batch);
    for (const { path, purpose } of purposes) {
      await db.run(
        `UPDATE files SET purpose = ?, updated_at = datetime('now')
         WHERE project_id = ? AND path = ?`,
        [purpose, projectId, path],
      );
      updated++;
    }
  }

  log.info(`Summarized ${updated}/${candidates.length} file purpose(s)`);
  return { updated, candidates: candidates.length, skipped: null };
}

/** Count files the summarizer would actually process — used to decide whether
 *  to queue the job. Must apply the same filters as findPurposeCandidates, or
 *  refresh re-queues no-op jobs forever for non-code/deleted files. */
export async function countPurposeCandidates(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
): Promise<number> {
  const rows = await db.all<{ path: string }>(
    `SELECT path FROM files
     WHERE project_id = ? AND status = 'active' AND (${JUNK_PURPOSE_WHERE})`,
    [projectId],
  );
  return rows.filter((r) => CODE_EXTENSIONS.test(r.path) && existsSync(join(projectPath, r.path))).length;
}

/** Purposes the structural capture path produces that carry no information. */
const JUNK_PURPOSE_WHERE = `purpose IS NULL
  OR purpose LIKE 'Exports:%'
  OR purpose LIKE 'Auto-created from%'
  OR length(purpose) < 25`;

// ============================================================================
// Candidate Selection
// ============================================================================

async function findPurposeCandidates(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
): Promise<PurposeCandidate[]> {
  const rows = await db.all<{ path: string }>(
    `SELECT path FROM files
     WHERE project_id = ? AND status = 'active' AND (${JUNK_PURPOSE_WHERE})
     ORDER BY fragility DESC, path ASC`,
    [projectId],
  );

  const candidates: PurposeCandidate[] = [];
  for (const row of rows) {
    if (!CODE_EXTENSIONS.test(row.path)) continue;
    const full = join(projectPath, row.path);
    if (!existsSync(full)) continue;
    try {
      if (statSync(full).size > MAX_FILE_BYTES) continue;
      const head = readFileSync(full, "utf-8").split("\n").slice(0, HEAD_LINES).join("\n");
      if (head.trim().length === 0) continue;
      candidates.push({ path: row.path, head });
    } catch {
      // Unreadable — skip
    }
  }
  return candidates;
}

// ============================================================================
// LLM Call
// ============================================================================

export function buildSummaryPrompt(batch: PurposeCandidate[]): string {
  const files = batch
    .map((c) => `=== ${c.path} ===\n${c.head}`)
    .join("\n\n");

  return `For each file below, write a one-sentence purpose (max 120 chars) describing what the file DOES in the system — not a list of its exports. Write for an engineer deciding whether this file is relevant to their task.

Return ONLY a JSON array: [{"path": "...", "purpose": "..."}]

${files}`;
}

export function parsePurposes(response: string, validPaths: Set<string>): Array<{ path: string; purpose: string }> {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (jsonMatch ? jsonMatch[1] : response).trim();
    const parsed = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is { path: string; purpose: string } =>
          typeof item === "object" && item !== null &&
          typeof (item as { path?: unknown }).path === "string" &&
          typeof (item as { purpose?: unknown }).purpose === "string",
      )
      .filter((item) => validPaths.has(item.path) && item.purpose.trim().length > 0)
      .map((item) => ({ path: item.path, purpose: item.purpose.trim().slice(0, 200) }));
  } catch {
    return [];
  }
}

async function summarizeBatch(
  apiKey: string,
  batch: PurposeCandidate[],
): Promise<Array<{ path: string; purpose: string }>> {
  const model = process.env.MUNINN_SUMMARY_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [{ role: "user", content: buildSummaryPrompt(batch) }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn(`Purpose summary API error ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    return parsePurposes(data.content[0]?.text ?? "[]", new Set(batch.map((c) => c.path)));
  } catch (err) {
    log.warn(`Purpose summary failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
