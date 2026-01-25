/**
 * Blast Radius Engine
 *
 * Computes transitive dependency impact using BFS.
 * Shows what files are affected when you change a file.
 */

import type { Database } from "bun:sqlite";
import type { BlastComputeOptions, BlastResult, BlastSummary } from "../types";
import { logError, safeJsonParse } from "../utils/errors";
import { outputJson } from "../utils/format";
import { buildDependencyGraph } from "./deps";

// ============================================================================
// File Classification
// ============================================================================

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /\/test\//,
  /\/tests\//,
  /\.stories\.[jt]sx?$/, // Storybook
];

const ROUTE_PATTERNS = [
  /\/routes\//,
  /\/pages\//,
  /\/app\/.*\/page\.[jt]sx?$/, // Next.js app router
  /\/api\//,
  /\+page\.svelte$/, // SvelteKit
  /\+server\.[jt]s$/, // SvelteKit API
];

function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(path));
}

function isRouteFile(path: string): boolean {
  return ROUTE_PATTERNS.some((p) => p.test(path));
}

// ============================================================================
// Blast Score Calculation
// ============================================================================

/**
 * Calculate blast score (0-100) based on impact metrics.
 *
 * Formula:
 * - Base: total affected files (capped at 50 points)
 * - Test multiplier: +20 if tests affected
 * - Route multiplier: +20 if routes affected
 * - Depth penalty: +10 for deep chains (>3 hops)
 */
function calculateBlastScore(
  totalAffected: number,
  affectedTests: number,
  affectedRoutes: number,
  maxDepth: number
): number {
  // Base score from affected files (logarithmic scale)
  const baseScore = Math.min(50, Math.log2(totalAffected + 1) * 10);

  // Test impact (tests breaking = bad)
  const testScore = affectedTests > 0 ? 20 : 0;

  // Route impact (user-facing breakage = bad)
  const routeScore = affectedRoutes > 0 ? 20 : 0;

  // Depth penalty (deep chains = hard to debug)
  const depthScore = maxDepth > 3 ? 10 : 0;

  return Math.min(100, baseScore + testScore + routeScore + depthScore);
}

/**
 * Get risk level from blast score
 */
function getRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
  if (score < 25) return "low";
  if (score < 50) return "medium";
  if (score < 75) return "high";
  return "critical";
}

// ============================================================================
// BFS Transitive Computation
// ============================================================================

interface TransitiveResult {
  affected: Map<string, { distance: number; path: string[] }>;
  maxDepth: number;
}

/**
 * Compute transitive dependents using BFS.
 * Returns all files that would be affected if sourceFile changes.
 */
function computeTransitiveDependents(
  sourceFile: string,
  dependentsMap: Map<string, string[]>,
  maxDepth: number = 10
): TransitiveResult {
  const affected = new Map<string, { distance: number; path: string[] }>();
  const queue: Array<{ file: string; distance: number; path: string[] }> = [];
  let maxDepthFound = 0;

  // Get direct dependents to start
  const directDependents = dependentsMap.get(sourceFile) || [];

  for (const dep of directDependents) {
    queue.push({ file: dep, distance: 1, path: [sourceFile, dep] });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    // Skip if already visited with shorter path
    const existing = affected.get(current.file);
    if (existing && existing.distance <= current.distance) {
      continue;
    }

    // Skip if exceeds max depth
    if (current.distance > maxDepth) {
      continue;
    }

    // Record this file
    affected.set(current.file, {
      distance: current.distance,
      path: current.path,
    });

    maxDepthFound = Math.max(maxDepthFound, current.distance);

    // Add dependents of this file to queue
    const nextDependents = dependentsMap.get(current.file) || [];
    for (const next of nextDependents) {
      const existing = affected.get(next);
      if (!existing || existing.distance > current.distance + 1) {
        queue.push({
          file: next,
          distance: current.distance + 1,
          path: [...current.path, next],
        });
      }
    }
  }

  return { affected, maxDepth: maxDepthFound };
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Store blast radius data for a single file
 */
function storeBlastRadius(db: Database, projectId: number, sourceFile: string, result: TransitiveResult): void {
  // Clear existing data for this file
  db.run(`DELETE FROM blast_radius WHERE project_id = ? AND source_file = ?`, [projectId, sourceFile]);

  // Insert new edges
  const insertStmt = db.prepare(`
    INSERT INTO blast_radius
    (project_id, source_file, affected_file, distance, dependency_path, is_test, is_route, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  for (const [affectedFile, info] of result.affected) {
    insertStmt.run(
      projectId,
      sourceFile,
      affectedFile,
      info.distance,
      JSON.stringify(info.path),
      isTestFile(affectedFile) ? 1 : 0,
      isRouteFile(affectedFile) ? 1 : 0
    );
  }
}

/**
 * Compute and store blast summary for a file
 */
function storeBlastSummary(
  db: Database,
  projectId: number,
  sourceFile: string,
  result: TransitiveResult
): BlastSummary {
  let directCount = 0;
  let transitiveCount = 0;
  let testCount = 0;
  let routeCount = 0;

  for (const [file, info] of result.affected) {
    if (info.distance === 1) {
      directCount++;
    } else {
      transitiveCount++;
    }
    if (isTestFile(file)) testCount++;
    if (isRouteFile(file)) routeCount++;
  }

  const totalAffected = result.affected.size;
  const blastScore = calculateBlastScore(totalAffected, testCount, routeCount, result.maxDepth);

  // Upsert summary
  db.run(
    `
    INSERT INTO blast_summary
    (project_id, file_path, direct_dependents, transitive_dependents, total_affected,
     max_depth, affected_tests, affected_routes, blast_score, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, file_path) DO UPDATE SET
      direct_dependents = excluded.direct_dependents,
      transitive_dependents = excluded.transitive_dependents,
      total_affected = excluded.total_affected,
      max_depth = excluded.max_depth,
      affected_tests = excluded.affected_tests,
      affected_routes = excluded.affected_routes,
      blast_score = excluded.blast_score,
      computed_at = excluded.computed_at
  `,
    [
      projectId,
      sourceFile,
      directCount,
      transitiveCount,
      totalAffected,
      result.maxDepth,
      testCount,
      routeCount,
      blastScore,
    ]
  );

  return {
    file_path: sourceFile,
    direct_dependents: directCount,
    transitive_dependents: transitiveCount,
    total_affected: totalAffected,
    max_depth: result.maxDepth,
    affected_tests: testCount,
    affected_routes: routeCount,
    blast_score: blastScore,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute blast radius for the entire project.
 * Builds dependency graph and calculates transitive impact for all files.
 */
export function computeBlastRadius(
  db: Database,
  projectId: number,
  projectPath: string,
  options: BlastComputeOptions = {}
): { processed: number; highImpact: number; errors: number } {
  const { maxDepth = 10, maxFiles = 500 } = options;

  console.error("🔥 Computing blast radius...\n");

  // Build dependency graph
  const graph = buildDependencyGraph(projectPath, maxFiles);

  // Create dependents map for fast lookup
  const dependentsMap = new Map<string, string[]>();
  for (const [path, info] of graph.files) {
    dependentsMap.set(path, info.dependents);
  }

  let processed = 0;
  let highImpact = 0;
  let errors = 0;

  // Process each file
  for (const [filePath] of graph.files) {
    try {
      const result = computeTransitiveDependents(filePath, dependentsMap, maxDepth);

      if (result.affected.size > 0) {
        storeBlastRadius(db, projectId, filePath, result);
        const summary = storeBlastSummary(db, projectId, filePath, result);

        if (summary.blast_score >= 50) {
          highImpact++;
        }
      }

      processed++;
    } catch (error) {
      logError("computeBlastRadius:file", error);
      errors++;
    }
  }

  console.error(`✅ Processed ${processed} files`);
  console.error(`🔴 ${highImpact} high-impact files (score >= 50)`);
  if (errors > 0) {
    console.error(`⚠️  ${errors} errors`);
  }
  console.error("");

  outputJson({ processed, highImpact, errors });

  return { processed, highImpact, errors };
}

/**
 * Get blast radius for a specific file.
 * Uses cached data if available, otherwise computes on demand.
 */
export function getBlastRadius(
  db: Database,
  projectId: number,
  projectPath: string,
  filePath: string,
  options: BlastComputeOptions = {}
): BlastResult | null {
  const { forceRefresh = false } = options;

  // Check for cached summary
  if (!forceRefresh) {
    const cached = db
      .query<BlastSummary, [number, string]>(`
      SELECT * FROM blast_summary WHERE project_id = ? AND file_path = ?
    `)
      .get(projectId, filePath);

    if (cached) {
      // Get cached edges
      const edges = db
        .query<
          {
            affected_file: string;
            distance: number;
            dependency_path: string | null;
            is_test: number;
            is_route: number;
          },
          [number, string]
        >(`
        SELECT affected_file, distance, dependency_path, is_test, is_route
        FROM blast_radius
        WHERE project_id = ? AND source_file = ?
        ORDER BY distance ASC
      `)
        .all(projectId, filePath);

      const directDependents: string[] = [];
      const transitiveDependents: Array<{ file: string; distance: number; path: string[] }> = [];
      const affectedTests: string[] = [];
      const affectedRoutes: string[] = [];

      for (const edge of edges) {
        const path = safeJsonParse<string[]>(edge.dependency_path || "[]", []);

        if (edge.distance === 1) {
          directDependents.push(edge.affected_file);
        } else {
          transitiveDependents.push({
            file: edge.affected_file,
            distance: edge.distance,
            path,
          });
        }

        if (edge.is_test) affectedTests.push(edge.affected_file);
        if (edge.is_route) affectedRoutes.push(edge.affected_file);
      }

      return {
        file: filePath,
        summary: cached,
        directDependents,
        transitiveDependents,
        affectedTests,
        affectedRoutes,
        riskLevel: getRiskLevel(cached.blast_score),
      };
    }
  }

  // Compute on demand
  const graph = buildDependencyGraph(projectPath, 300);

  // Create dependents map
  const dependentsMap = new Map<string, string[]>();
  for (const [path, info] of graph.files) {
    dependentsMap.set(path, info.dependents);
  }

  const result = computeTransitiveDependents(filePath, dependentsMap, options.maxDepth || 10);

  if (result.affected.size === 0) {
    return {
      file: filePath,
      summary: {
        file_path: filePath,
        direct_dependents: 0,
        transitive_dependents: 0,
        total_affected: 0,
        max_depth: 0,
        affected_tests: 0,
        affected_routes: 0,
        blast_score: 0,
      },
      directDependents: [],
      transitiveDependents: [],
      affectedTests: [],
      affectedRoutes: [],
      riskLevel: "low",
    };
  }

  // Store for future use
  storeBlastRadius(db, projectId, filePath, result);
  const summary = storeBlastSummary(db, projectId, filePath, result);

  const directDependents: string[] = [];
  const transitiveDependents: Array<{ file: string; distance: number; path: string[] }> = [];
  const affectedTests: string[] = [];
  const affectedRoutes: string[] = [];

  for (const [file, info] of result.affected) {
    if (info.distance === 1) {
      directDependents.push(file);
    } else {
      transitiveDependents.push({
        file,
        distance: info.distance,
        path: info.path,
      });
    }

    if (isTestFile(file)) affectedTests.push(file);
    if (isRouteFile(file)) affectedRoutes.push(file);
  }

  return {
    file: filePath,
    summary,
    directDependents,
    transitiveDependents,
    affectedTests,
    affectedRoutes,
    riskLevel: getRiskLevel(summary.blast_score),
  };
}

/**
 * Get high-impact files for the project.
 */
export function getHighImpactFiles(db: Database, projectId: number, minScore: number = 50): BlastSummary[] {
  return db
    .query<BlastSummary, [number, number]>(`
    SELECT * FROM blast_summary
    WHERE project_id = ? AND blast_score >= ?
    ORDER BY blast_score DESC
    LIMIT 20
  `)
    .all(projectId, minScore);
}

/**
 * Display blast radius for a file (CLI output)
 */
export function showBlastRadius(db: Database, projectId: number, projectPath: string, filePath: string): void {
  const result = getBlastRadius(db, projectId, projectPath, filePath);

  if (!result) {
    console.error(`❌ Could not compute blast radius for ${filePath}`);
    return;
  }

  const { summary, directDependents, transitiveDependents, affectedTests, affectedRoutes, riskLevel } = result;

  // Risk emoji
  const riskEmoji = {
    low: "🟢",
    medium: "🟡",
    high: "🟠",
    critical: "🔴",
  }[riskLevel];

  console.error(`\n🔥 Blast Radius: ${filePath}\n`);
  console.error(`${riskEmoji} Risk Level: ${riskLevel.toUpperCase()} (score: ${summary.blast_score.toFixed(1)})`);
  console.error(`📊 Total Affected: ${summary.total_affected} files`);
  console.error(`   Direct: ${summary.direct_dependents} | Transitive: ${summary.transitive_dependents}`);
  console.error(`   Max Depth: ${summary.max_depth} hops\n`);

  if (directDependents.length > 0) {
    console.error(`📤 Direct Dependents (${directDependents.length}):`);
    for (const dep of directDependents.slice(0, 10)) {
      console.error(`   ← ${dep}`);
    }
    if (directDependents.length > 10) {
      console.error(`   ... and ${directDependents.length - 10} more`);
    }
    console.error("");
  }

  if (transitiveDependents.length > 0) {
    console.error(`🔗 Transitive Dependents (${transitiveDependents.length}):`);
    for (const dep of transitiveDependents.slice(0, 8)) {
      console.error(`   ← ${dep.file} (${dep.distance} hops)`);
    }
    if (transitiveDependents.length > 8) {
      console.error(`   ... and ${transitiveDependents.length - 8} more`);
    }
    console.error("");
  }

  if (affectedTests.length > 0) {
    console.error(`🧪 Affected Tests (${affectedTests.length}):`);
    for (const test of affectedTests.slice(0, 5)) {
      console.error(`   🧪 ${test}`);
    }
    if (affectedTests.length > 5) {
      console.error(`   ... and ${affectedTests.length - 5} more`);
    }
    console.error("");
  }

  if (affectedRoutes.length > 0) {
    console.error(`🌐 Affected Routes (${affectedRoutes.length}):`);
    for (const route of affectedRoutes.slice(0, 5)) {
      console.error(`   🌐 ${route}`);
    }
    if (affectedRoutes.length > 5) {
      console.error(`   ... and ${affectedRoutes.length - 5} more`);
    }
    console.error("");
  }

  outputJson(result);
}

/**
 * Show high-impact files in the project
 */
export function showHighImpactFiles(db: Database, projectId: number): void {
  const files = getHighImpactFiles(db, projectId, 30);

  if (files.length === 0) {
    console.error("\n✅ No high-impact files found (all files have blast score < 30)\n");
    outputJson({ files: [] });
    return;
  }

  console.error("\n🔥 High-Impact Files\n");
  console.error("Files that affect many others when changed:\n");

  for (const file of files) {
    const riskLevel = getRiskLevel(file.blast_score);
    const emoji = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" }[riskLevel];

    console.error(`${emoji} ${file.file_path}`);
    console.error(
      `   Score: ${file.blast_score.toFixed(1)} | Affected: ${file.total_affected} | Tests: ${file.affected_tests} | Routes: ${file.affected_routes}`
    );
  }
  console.error("");

  outputJson({ files });
}
