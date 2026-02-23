/**
 * Muninn MCP Server — Shared State Module
 *
 * Centralized mutable state with getter/setter access pattern.
 * This module is the "base" of the extracted files — it imports
 * from none of the other mcp-* extraction targets.
 */

import type { DatabaseAdapter } from "./database/adapter";
import { SessionState } from "./session-state.js";
import { applyWeightAdjustments, buildContextOutput } from "./context/budget-manager.js";
import type { TaskContext } from "./context/task-analyzer.js";
// ============================================================================
// Shared State (initialized once at server startup)
// ============================================================================

let dbAdapter: DatabaseAdapter | null = null;
const projectIdCache = new Map<string, number>();
let sessionState: SessionState | null = null;
let consecutiveKeepaliveFailures = 0;
let consecutiveSlowCalls = 0;

// Rate-limited exception tracking: survive sporadic exceptions, die on systemic failure
const exceptionWindow: number[] = [];
const EXCEPTION_WINDOW_MS = 120_000;
const MAX_EXCEPTIONS_IN_WINDOW = 30;

// Track whether session has been auto-started for this process lifetime
let sessionAutoStarted = false;
// Track whether initial task analysis has been done
let taskAnalyzed = false;
// Track whether embedding cache has been warmed
let embeddingCacheWarmed = false;
// Worker spawn rate-limiting
let lastWorkerSpawnAt = 0;
const WORKER_SPAWN_COOLDOWN_MS = 5 * 60_000; // 5 minutes
// Cached budget weights from confidence calibrator
let cachedBudgetWeights: Record<string, number> = {};
let budgetWeightsLoaded = false;

// Lazily loaded connection module (cached after first import)
let connModule: typeof import("./database/connection") | null = null;

// ============================================================================
// Getters & Setters
// ============================================================================

export function getDbAdapter(): DatabaseAdapter | null {
  return dbAdapter;
}

export function setDbAdapter(adapter: DatabaseAdapter | null): void {
  dbAdapter = adapter;
}

export function getConsecutiveKeepaliveFailures(): number {
  return consecutiveKeepaliveFailures;
}

export function setConsecutiveKeepaliveFailures(n: number): void {
  consecutiveKeepaliveFailures = n;
}

export function getConsecutiveSlowCalls(): number {
  return consecutiveSlowCalls;
}

export function setConsecutiveSlowCalls(n: number): void {
  consecutiveSlowCalls = n;
}

export function getExceptionWindow(): number[] {
  return exceptionWindow;
}

export { EXCEPTION_WINDOW_MS, MAX_EXCEPTIONS_IN_WINDOW };

export function getSessionAutoStarted(): boolean {
  return sessionAutoStarted;
}

export function setSessionAutoStarted(v: boolean): void {
  sessionAutoStarted = v;
}

export function getTaskAnalyzed(): boolean {
  return taskAnalyzed;
}

export function setTaskAnalyzed(v: boolean): void {
  taskAnalyzed = v;
}

export function getEmbeddingCacheWarmed(): boolean {
  return embeddingCacheWarmed;
}

export function setEmbeddingCacheWarmed(v: boolean): void {
  embeddingCacheWarmed = v;
}

export function getLastWorkerSpawnAt(): number {
  return lastWorkerSpawnAt;
}

export function setLastWorkerSpawnAt(ts: number): void {
  lastWorkerSpawnAt = ts;
}

export { WORKER_SPAWN_COOLDOWN_MS };

export function getCachedBudgetWeights(): Record<string, number> {
  return cachedBudgetWeights;
}

export function setCachedBudgetWeights(w: Record<string, number>): void {
  cachedBudgetWeights = w;
}

export function getBudgetWeightsLoaded(): boolean {
  return budgetWeightsLoaded;
}

export function setBudgetWeightsLoaded(v: boolean): void {
  budgetWeightsLoaded = v;
}

// ============================================================================
// Exception Classification
// ============================================================================

/** Exceptions that don't count toward the crash threshold.
 *  Broadly classify to avoid killing the server over transient errors.
 *  The server should only die for truly systemic failures. */
export function isExpectedException(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return msg.includes("validation") ||
    msg.includes("invalid params") ||
    msg.includes("not found") ||
    msg.includes("circuit breaker open") ||
    msg.includes("must be called before") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("epipe") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("socket") ||
    msg.includes("sql") ||
    msg.includes("sqlite") ||
    msg.includes("no such table") ||
    msg.includes("no such column") ||
    msg.includes("database") ||
    msg.includes("busy") ||
    msg.includes("locked");
}

// ============================================================================
// Connection & Session Helpers
// ============================================================================

async function loadConnectionModule() {
  if (!connModule) {
    connModule = await import("./database/connection");
  }
  return connModule;
}

export function getSessionState(cwd: string): SessionState {
  if (!sessionState) {
    sessionState = new SessionState(cwd);
  }
  return sessionState;
}

/**
 * Get or initialize the shared database adapter.
 * Creates one connection and reuses it for the process lifetime.
 * The HttpAdapter handles all connection resilience internally
 * (retries + circuit breaker) — we never reset it from outside.
 */
export async function getDb(): Promise<DatabaseAdapter> {
  if (dbAdapter) return dbAdapter;

  const conn = await loadConnectionModule();
  dbAdapter = await conn.getGlobalDb();
  consecutiveKeepaliveFailures = 0;
  return dbAdapter;
}

/**
 * Get or cache the project ID for a given working directory.
 */
export async function getProjectId(db: DatabaseAdapter, cwd: string): Promise<number> {
  const cached = projectIdCache.get(cwd);
  if (cached !== undefined) return cached;

  const conn = await loadConnectionModule();
  const projectId = await conn.ensureProject(db, cwd);
  projectIdCache.set(cwd, projectId);
  return projectId;
}

// ============================================================================
// Command Whitelist for Passthrough Tool
// ============================================================================

export const ALLOWED_PASSTHROUGH_COMMANDS = new Set([
  "status",
  "fragile",
  "brief",
  "resume",
  "outcome",
  "insights",
  "bookmark",
  "bm",
  "focus",
  "observe",
  "obs",
  "debt",
  "pattern",
  "stack",
  "temporal",
  "profile",
  "workflow",
  "wf",
  "foundational",
  "correlations",
  "git-info",
  "sync-hashes",
  "drift",
  "conflicts",
  "deps",
  "blast",
  "db",
  "smart-status",
  "ss",
  "ingest",
  "install-hook",
]);

/**
 * Parse command string into argument array without shell interpretation.
 * Handles quoted strings safely.
 */
export function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of command) {
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

// ============================================================================
// Calibrated Context Builder
// ============================================================================

/** Build context output with calibrated budget weights applied */
export function buildCalibratedContext(ctx: TaskContext, budget?: number): string {
  const defaultAlloc = {
    contradictions: 300, criticalWarnings: 350, decisions: 350,
    learnings: 350, fileContext: 350, errorFixes: 150, reserve: 150,
  };
  const adjusted = applyWeightAdjustments(defaultAlloc, cachedBudgetWeights);
  return buildContextOutput(ctx, budget, adjusted);
}
