/**
 * v10 Prompt Map — task-scoped codebase map for the UserPromptSubmit hook.
 *
 * Matches a user prompt against the precomputed `.muninn/context/map.json`
 * (file purposes, symbols, co-change relationships) and prints a compact map
 * of likely-relevant files. The point: Claude skips the Glob/Grep/Read
 * exploration phase because the map already says where things live.
 *
 * HARD CONSTRAINT: this module is executed directly by a hook
 * (`bun prompt-map.ts <mapPath> [stateFile]`, prompt on stdin). It must never
 * import the database layer or anything network-bound — local file reads only.
 * Silence (empty stdout) on any failure or weak match.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PromptMap } from "./context-cache.js";

// ============================================================================
// Types
// ============================================================================

export interface MatchedFile {
  path: string;
  purpose: string | null;
  fragility: number;
  score: number;
}

interface ScoredEntry {
  entry: PromptMap["files"][number];
  score: number;
  distinctHits: number;
}

// ============================================================================
// Tuning
// ============================================================================

const MIN_SCORE = 4;
const MIN_DISTINCT_HITS = 2;
const MAX_FILES = 8;
const MAX_RELATIONS = 5;
const MIN_PROMPT_TOKENS = 2;

const WEIGHT_FILENAME = 3;
const WEIGHT_SYMBOL = 2;
const WEIGHT_DIR = 1;
const WEIGHT_PURPOSE = 1;

/** Words too generic to locate anything. Includes coding-task verbs. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "are", "was", "were", "has", "have",
  "had", "not", "but", "can", "you", "your", "our", "its", "all", "any", "when", "then", "than",
  "there", "here", "what", "which", "where", "how", "why", "who", "will", "would", "should", "could",
  "please", "just", "also", "make", "made", "need", "needs", "want", "wants", "let", "lets", "get",
  "gets", "use", "using", "used", "add", "adds", "added", "fix", "fixes", "fixed", "update",
  "updates", "updated", "change", "changes", "changed", "new", "now", "run", "runs", "running",
  "look", "looks", "looking", "check", "checks", "see", "show", "shows", "work", "works", "working",
  "file", "files", "code", "issue", "bug", "error", "errors", "problem", "thing", "things", "way",
  "dont", "doesnt", "isnt", "cant", "wont", "still", "again", "some", "more", "most", "like", "one",
]);

// ============================================================================
// Tokenization
// ============================================================================

/** Split camelCase/kebab/snake/path segments into lowercase tokens, len >= 3. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function promptTokens(prompt: string): string[] {
  return [...new Set(tokenize(prompt))];
}

// ============================================================================
// Matching
// ============================================================================

export function matchPrompt(prompt: string, map: PromptMap): MatchedFile[] {
  const tokens = promptTokens(prompt);
  if (tokens.length < MIN_PROMPT_TOKENS) return [];

  const scored: ScoredEntry[] = [];
  for (const entry of map.files) {
    const result = scoreEntry(entry, tokens);
    if (result.score >= MIN_SCORE && result.distinctHits >= MIN_DISTINCT_HITS) {
      scored.push(result);
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FILES)
    .map(({ entry, score }) => ({
      path: entry.p,
      purpose: entry.purpose,
      fragility: entry.frag,
      score,
    }));
}

function scoreEntry(entry: PromptMap["files"][number], tokens: string[]): ScoredEntry {
  const segments = entry.p.split("/");
  const filename = new Set(tokenize(segments[segments.length - 1] ?? ""));
  const dirs = new Set(tokenize(segments.slice(0, -1).join(" ")));
  const symbols = new Set(entry.sym.flatMap(tokenize));
  const purpose = new Set(entry.purpose ? tokenize(entry.purpose) : []);

  let score = 0;
  let distinctHits = 0;
  for (const token of tokens) {
    let hit = 0;
    if (filename.has(token)) hit = Math.max(hit, WEIGHT_FILENAME);
    if (symbols.has(token)) hit = Math.max(hit, WEIGHT_SYMBOL);
    if (dirs.has(token)) hit = Math.max(hit, WEIGHT_DIR);
    if (purpose.has(token)) hit = Math.max(hit, WEIGHT_PURPOSE);
    if (hit > 0) {
      score += hit;
      distinctHits++;
    }
  }
  return { entry, score, distinctHits };
}

// ============================================================================
// Formatting
// ============================================================================

export function formatTaskMap(matches: MatchedFile[], map: PromptMap): string {
  if (matches.length === 0) return "";

  const lines: string[] = ["[muninn task map — likely relevant files]"];
  for (const m of matches) {
    const frag = m.fragility >= 6 ? ` (fragility ${m.fragility}/10 — context injects on read)` : "";
    const purpose = m.purpose ? ` — ${m.purpose.trim().replace(/\s+/g, " ")}` : "";
    lines.push(`- ${m.path}${purpose}${frag}`);
  }

  const selected = new Set(matches.map((m) => m.path));
  const relations = map.rel
    .filter(([a, b]) => selected.has(a) && selected.has(b))
    .sort((x, y) => y[2] - x[2])
    .slice(0, MAX_RELATIONS);
  if (relations.length > 0) {
    lines.push(`Change together: ${relations.map(([a, b, n]) => `${a} + ${b} (${n}x)`).join("; ")}`);
  }

  return `${lines.join("\n")}\n`;
}

// ============================================================================
// CLI entry — invoked by hooks/user-prompt-map.sh
// ============================================================================

/** Skip prompts that cannot name code: too short, slash commands, bare answers. */
export function shouldSkipPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  return trimmed.length < 12 || trimmed.startsWith("/") || trimmed.startsWith("!");
}

function runCli(): void {
  const [mapPath, stateFile] = process.argv.slice(2);
  if (!mapPath || !existsSync(mapPath)) return;

  const prompt = readFileSync(0, "utf-8");
  if (shouldSkipPrompt(prompt)) return;

  const map = JSON.parse(readFileSync(mapPath, "utf-8")) as PromptMap;
  if (map.version !== 1) return;

  const matches = matchPrompt(prompt, map);
  if (matches.length === 0) return;

  // Dedupe: if the last injection for this session covered the same files, stay silent.
  const signature = matches.map((m) => m.path).join("|");
  if (stateFile) {
    try {
      if (existsSync(stateFile) && readFileSync(stateFile, "utf-8") === signature) return;
      writeFileSync(stateFile, signature);
    } catch {
      // State tracking is best-effort; never block the injection on it
    }
  }

  process.stdout.write(formatTaskMap(matches, map));
}

if (import.meta.main) {
  try {
    runCli();
  } catch {
    // Silence on any failure — hooks must never surface errors
  }
}
