/**
 * Impact Analyzer — Function-level change impact assessment
 *
 * Combines call graph + test-source map for precise impact analysis.
 * "If I change function X" -> affected callers (transitive) + tests to run.
 *
 * Upgrades blast radius from file-level heuristic to function-level precision.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface ImpactResult {
  file: string;
  symbol: string | null;
  directCallers: CallerInfo[];
  transitiveCallers: CallerInfo[];
  affectedTests: TestInfo[];
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

interface CallerInfo {
  file: string;
  symbol: string;
  distance: number;
  confidence: number;
}

interface TestInfo {
  testFile: string;
  sourceSymbol: string | null;
  matchType: string;
  confidence: number;
}

// ============================================================================
// Impact Analysis
// ============================================================================

/**
 * Analyze the impact of changing a specific symbol in a file.
 * Uses call graph for caller traversal + test-source map for test discovery.
 */
export async function analyzeImpact(
  db: DatabaseAdapter,
  projectId: number,
  file: string,
  symbol?: string
): Promise<ImpactResult> {
  const directCallers: CallerInfo[] = [];
  const transitiveCallers: CallerInfo[] = [];
  const affectedTests: TestInfo[] = [];
  const visitedCallers = new Set<string>();

  // Step 1: Find direct callers from call graph
  if (symbol) {
    const callers = await db.all<{
      caller_file: string;
      caller_symbol: string;
      confidence: number;
    }>(
      `SELECT caller_file, caller_symbol, confidence
       FROM call_graph
       WHERE project_id = ? AND callee_file = ? AND callee_symbol = ?
       ORDER BY confidence DESC`,
      [projectId, file, symbol]
    );

    for (const c of callers) {
      const key = `${c.caller_file}:${c.caller_symbol}`;
      visitedCallers.add(key);
      directCallers.push({
        file: c.caller_file,
        symbol: c.caller_symbol,
        distance: 1,
        confidence: c.confidence,
      });
    }
  }

  // Also find file-level callers (any symbol calling into this file)
  const fileCallers = await db.all<{
    caller_file: string;
    caller_symbol: string;
    confidence: number;
  }>(
    `SELECT DISTINCT caller_file, caller_symbol, MAX(confidence) as confidence
     FROM call_graph
     WHERE project_id = ? AND callee_file = ?
     GROUP BY caller_file, caller_symbol
     ORDER BY confidence DESC
     LIMIT 50`,
    [projectId, file]
  );

  for (const c of fileCallers) {
    const key = `${c.caller_file}:${c.caller_symbol}`;
    if (!visitedCallers.has(key)) {
      visitedCallers.add(key);
      directCallers.push({
        file: c.caller_file,
        symbol: c.caller_symbol,
        distance: 1,
        confidence: c.confidence * 0.8,
      });
    }
  }

  // Step 2: Transitive callers (BFS, max depth 4)
  const queue = directCallers.map((c) => ({ ...c, depth: 1 }));
  const maxDepth = 4;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) continue;

    const nextCallers = await db.all<{
      caller_file: string;
      caller_symbol: string;
      confidence: number;
    }>(
      `SELECT caller_file, caller_symbol, confidence
       FROM call_graph
       WHERE project_id = ? AND callee_file = ? AND callee_symbol = ?
       ORDER BY confidence DESC
       LIMIT 20`,
      [projectId, current.file, current.symbol]
    );

    for (const c of nextCallers) {
      const key = `${c.caller_file}:${c.caller_symbol}`;
      if (visitedCallers.has(key)) continue;
      visitedCallers.add(key);

      const caller: CallerInfo = {
        file: c.caller_file,
        symbol: c.caller_symbol,
        distance: current.depth + 1,
        confidence: c.confidence * current.confidence,
      };

      transitiveCallers.push(caller);
      queue.push({ ...caller, depth: current.depth + 1 });
    }
  }

  // Step 3: Find affected tests via test-source map
  const testMappings = await db.all<{
    test_file: string;
    source_symbol: string | null;
    match_type: string;
    confidence: number;
  }>(
    `SELECT test_file, source_symbol, match_type, confidence
     FROM test_source_map
     WHERE project_id = ? AND source_file = ?
     ORDER BY confidence DESC`,
    [projectId, file]
  );

  const seenTests = new Set<string>();
  for (const t of testMappings) {
    if (seenTests.has(t.test_file)) continue;
    seenTests.add(t.test_file);

    // If we have a specific symbol, boost confidence for symbol-level matches
    const confidenceBoost = symbol && t.source_symbol === symbol ? 0.1 : 0;

    affectedTests.push({
      testFile: t.test_file,
      sourceSymbol: t.source_symbol,
      matchType: t.match_type,
      confidence: Math.min(1.0, t.confidence + confidenceBoost),
    });
  }

  // Also find tests for caller files (callers might have tests too)
  const callerFiles = new Set(directCallers.map((c) => c.file));
  for (const callerFile of callerFiles) {
    const callerTests = await db.all<{
      test_file: string;
      source_symbol: string | null;
      match_type: string;
      confidence: number;
    }>(
      `SELECT test_file, source_symbol, match_type, confidence
       FROM test_source_map
       WHERE project_id = ? AND source_file = ?
       ORDER BY confidence DESC
       LIMIT 3`,
      [projectId, callerFile]
    );

    for (const t of callerTests) {
      if (seenTests.has(t.test_file)) continue;
      seenTests.add(t.test_file);

      affectedTests.push({
        testFile: t.test_file,
        sourceSymbol: t.source_symbol,
        matchType: t.match_type,
        confidence: t.confidence * 0.7,
      });
    }
  }

  // Step 4: Calculate risk score
  const riskScore = calculateRiskScore(directCallers, transitiveCallers, affectedTests);
  const riskLevel = getRiskLevel(riskScore);

  return {
    file,
    symbol: symbol || null,
    directCallers,
    transitiveCallers,
    affectedTests: affectedTests.sort((a, b) => b.confidence - a.confidence),
    riskScore,
    riskLevel,
  };
}

/**
 * Analyze impact for multiple files at once (batch mode).
 */
export async function analyzeMultiFileImpact(
  db: DatabaseAdapter,
  projectId: number,
  files: string[]
): Promise<ImpactResult[]> {
  const results: ImpactResult[] = [];

  for (const file of files) {
    const result = await analyzeImpact(db, projectId, file);
    results.push(result);
  }

  return results.sort((a, b) => b.riskScore - a.riskScore);
}

// ============================================================================
// Scoring
// ============================================================================

function calculateRiskScore(
  directCallers: CallerInfo[],
  transitiveCallers: CallerInfo[],
  affectedTests: TestInfo[]
): number {
  // Base: direct callers (0-40 points)
  const directScore = Math.min(40, directCallers.length * 8);

  // Transitive reach (0-25 points)
  const transitiveScore = Math.min(25, Math.log2(transitiveCallers.length + 1) * 8);

  // Test coverage (0-25 points, inversely: fewer tests = higher risk)
  const testScore = affectedTests.length === 0
    ? 25
    : Math.max(0, 25 - affectedTests.length * 5);

  // Confidence-weighted caller spread (0-10 points)
  const uniqueCallerFiles = new Set([
    ...directCallers.map((c) => c.file),
    ...transitiveCallers.map((c) => c.file),
  ]);
  const spreadScore = Math.min(10, uniqueCallerFiles.size * 2);

  return Math.min(100, directScore + transitiveScore + testScore + spreadScore);
}

function getRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
  if (score < 25) return "low";
  if (score < 50) return "medium";
  if (score < 75) return "high";
  return "critical";
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format impact result as a concise summary for context injection.
 */
export function formatImpactSummary(result: ImpactResult): string {
  const lines: string[] = [];
  const { riskLevel, riskScore, directCallers, transitiveCallers, affectedTests } = result;

  const riskEmoji = { low: "G", medium: "Y", high: "O", critical: "R" }[riskLevel];
  const label = result.symbol
    ? `${result.file}:${result.symbol}`
    : result.file;

  lines.push(`[${riskEmoji}] Impact: ${label} — ${riskLevel} (${riskScore})`);

  if (directCallers.length > 0) {
    const callerList = directCallers
      .slice(0, 3)
      .map((c) => `${c.file}:${c.symbol}`)
      .join(", ");
    lines.push(`  Callers: ${directCallers.length} direct${transitiveCallers.length > 0 ? `, ${transitiveCallers.length} transitive` : ""}`);
    lines.push(`  Top: ${callerList}`);
  }

  if (affectedTests.length > 0) {
    const testList = affectedTests
      .slice(0, 3)
      .map((t) => t.testFile)
      .join(", ");
    lines.push(`  Tests: ${affectedTests.length} — ${testList}`);
  } else {
    lines.push(`  Tests: NONE — no test coverage found`);
  }

  return lines.join("\n");
}
