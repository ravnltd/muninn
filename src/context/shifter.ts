/**
 * Context Shifter
 *
 * Tracks conversation topic via sliding window of recent tool calls.
 * When focus diverges from session start, auto-updates the focus table.
 * Replaces manual `muninn focus set` with automatic detection.
 */

import type { DatabaseAdapter } from "../database/adapter";
import { extractFiles, extractKeywords, extractDomains } from "./task-analyzer";

// ============================================================================
// Types
// ============================================================================

interface ToolCallRecord {
  toolName: string;
  files: string[];
  keywords: string[];
  timestamp: number;
}

interface FocusSnapshot {
  files: Set<string>;
  keywords: Set<string>;
  domains: Set<string>;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_WINDOW = 5;
const DIVERGENCE_THRESHOLD = 0.3; // Jaccard similarity below this = focus shifted
const MIN_CALLS_FOR_SHIFT = 3; // Need at least 3 calls to detect a shift

// ============================================================================
// Module State
// ============================================================================

const recentCalls: ToolCallRecord[] = [];
let initialFocus: FocusSnapshot | null = null;
let lastAutoFocusAt = 0;
const AUTO_FOCUS_COOLDOWN_MS = 60_000; // Don't auto-focus more than once per minute

// ============================================================================
// Recording
// ============================================================================

/** Record a tool call for focus tracking */
export function recordToolCall(toolName: string, args: Record<string, unknown>): void {
  const files = extractFiles(args);
  const keywords = extractKeywords(toolName, args);

  const record: ToolCallRecord = {
    toolName,
    files,
    keywords,
    timestamp: Date.now(),
  };

  recentCalls.push(record);

  // Keep sliding window
  while (recentCalls.length > MAX_WINDOW) {
    recentCalls.shift();
  }

  // Capture initial focus from first few calls
  if (recentCalls.length <= 2 && !initialFocus) {
    initialFocus = computeSnapshot(recentCalls);
  }
}

// ============================================================================
// Focus Computation
// ============================================================================

/** Compute a focus snapshot from recent tool calls */
function computeSnapshot(calls: ToolCallRecord[]): FocusSnapshot {
  const files = new Set<string>();
  const keywords = new Set<string>();

  for (const call of calls) {
    for (const f of call.files) files.add(f);
    for (const k of call.keywords) keywords.add(k);
  }

  const domains = new Set(extractDomains(Array.from(files)));

  return { files, keywords, domains };
}

/** Compute Jaccard similarity between two sets */
function jaccardSimilarity<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1.0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

/** Check if the focus has diverged from initial context */
function hasFocusShifted(): boolean {
  if (!initialFocus) return false;
  if (recentCalls.length < MIN_CALLS_FOR_SHIFT) return false;

  const current = computeSnapshot(recentCalls);

  // Compare keywords (strongest signal)
  const keywordSim = jaccardSimilarity(current.keywords, initialFocus.keywords);

  // Compare domains (medium signal)
  const domainSim = jaccardSimilarity(current.domains, initialFocus.domains);

  // Weighted average
  const similarity = keywordSim * 0.6 + domainSim * 0.4;

  return similarity < DIVERGENCE_THRESHOLD;
}

/** Get the current focus area description from recent calls */
function getCurrentFocusArea(): string {
  const current = computeSnapshot(recentCalls);

  // Prefer domain names
  if (current.domains.size > 0) {
    return Array.from(current.domains).slice(0, 3).join(", ");
  }

  // Fall back to top keywords
  const topKeywords = Array.from(current.keywords).slice(0, 5);
  return topKeywords.join(", ") || "general";
}

// ============================================================================
// Auto-Update Focus
// ============================================================================

/**
 * Check if focus has shifted and auto-update if needed.
 * Called after each tool call, but respects cooldown.
 */
export async function checkAndUpdateFocus(
  db: DatabaseAdapter,
  projectId: number
): Promise<boolean> {
  // Respect cooldown
  if (Date.now() - lastAutoFocusAt < AUTO_FOCUS_COOLDOWN_MS) return false;
  if (!hasFocusShifted()) return false;

  const area = getCurrentFocusArea();
  if (!area || area === "general") return false;

  try {
    // Clear existing focus
    await db.run(
      `UPDATE focus SET cleared_at = CURRENT_TIMESTAMP
       WHERE project_id = ? AND cleared_at IS NULL`,
      [projectId]
    );

    // Set new auto-detected focus
    const current = computeSnapshot(recentCalls);
    await db.run(
      `INSERT INTO focus (project_id, area, description, files, keywords)
       VALUES (?, ?, ?, ?, ?)`,
      [
        projectId,
        area,
        "Auto-detected from tool usage pattern",
        JSON.stringify(Array.from(current.files).slice(0, 10)),
        JSON.stringify(Array.from(current.keywords).slice(0, 10)),
      ]
    );

    lastAutoFocusAt = Date.now();

    // Reset initial focus to current (so we detect the NEXT shift)
    initialFocus = current;

    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Utilities
// ============================================================================

/** Get current focus keywords for enrichment boosting */
export function getCurrentKeywords(): string[] {
  const current = computeSnapshot(recentCalls);
  return Array.from(current.keywords);
}

/** Get current focus files for enrichment boosting */
export function getCurrentFiles(): string[] {
  const current = computeSnapshot(recentCalls);
  return Array.from(current.files);
}

// ============================================================================
// v5 Phase 5: Context Quality Tracking
// ============================================================================

interface ContextQuality {
  contextFiles: Set<string>;   // Files mentioned in context
  accessedFiles: string[];     // Files actually accessed
  consecutiveMisses: number;   // Files accessed but not in context
  lastRefreshAt: number;
  totalAccesses: number;
  totalHits: number;
}

const quality: ContextQuality = {
  contextFiles: new Set(),
  accessedFiles: [],
  consecutiveMisses: 0,
  lastRefreshAt: 0,
  totalAccesses: 0,
  totalHits: 0,
};

const QUALITY_REFRESH_COOLDOWN_MS = 30_000; // 30s for quality-driven refreshes
const MISS_THRESHOLD = 3; // 3 consecutive misses triggers refresh

/**
 * Record which files the context predicted would be relevant.
 * Called after task analysis sets context.
 */
export function setContextFiles(files: string[]): void {
  quality.contextFiles = new Set(files);
  quality.consecutiveMisses = 0;
  quality.lastRefreshAt = Date.now();
}

/**
 * Record a file access (from Read/Edit/Write tool calls).
 * Tracks whether context predicted this file correctly.
 */
export function recordFileAccess(filePath: string): void {
  quality.accessedFiles.push(filePath);
  quality.totalAccesses++;

  if (quality.contextFiles.has(filePath)) {
    quality.totalHits++;
    quality.consecutiveMisses = 0;
  } else {
    quality.consecutiveMisses++;
  }

  // Keep sliding window of recent accesses
  if (quality.accessedFiles.length > 20) {
    quality.accessedFiles.shift();
  }
}

/**
 * Check if context should be refreshed based on quality signals.
 * Returns true if quality has degraded enough to justify a refresh.
 */
export function shouldRefreshContext(): boolean {
  // Respect cooldown
  if (Date.now() - quality.lastRefreshAt < QUALITY_REFRESH_COOLDOWN_MS) return false;

  // Not enough data yet
  if (quality.totalAccesses < 3) return false;

  // Consecutive miss threshold
  if (quality.consecutiveMisses >= MISS_THRESHOLD) return true;

  // Overall hit rate dropped below 30%
  const hitRate = quality.totalHits / quality.totalAccesses;
  if (quality.totalAccesses >= 5 && hitRate < 0.3) return true;

  return false;
}

/**
 * Reset quality tracking (called after a refresh).
 */
export function resetQuality(): void {
  quality.consecutiveMisses = 0;
  quality.lastRefreshAt = Date.now();
  quality.totalAccesses = 0;
  quality.totalHits = 0;
  quality.accessedFiles = [];
}

/**
 * Get current context quality metrics.
 */
export function getQualityMetrics(): { hitRate: number; misses: number; accesses: number } {
  return {
    hitRate: quality.totalAccesses > 0 ? quality.totalHits / quality.totalAccesses : 1,
    misses: quality.consecutiveMisses,
    accesses: quality.totalAccesses,
  };
}

/** Reset all state (for testing) */
export function resetShifter(): void {
  recentCalls.length = 0;
  initialFocus = null;
  lastAutoFocusAt = 0;
  quality.contextFiles.clear();
  quality.accessedFiles = [];
  quality.consecutiveMisses = 0;
  quality.lastRefreshAt = 0;
  quality.totalAccesses = 0;
  quality.totalHits = 0;
}
