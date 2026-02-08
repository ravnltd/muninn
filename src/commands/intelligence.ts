/**
 * Intelligence commands
 * Smart status, pre-edit checks, impact analysis
 */

import type { DatabaseAdapter } from "../database/adapter";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BlastSummary, FileCheck, ImpactResult, ProjectHealth, SmartStatus, StaleFile } from "../types";
import { safeJsonParse } from "../utils/errors";
import { computeContentHash, outputJson } from "../utils/format";
import { getBlastRadius } from "./blast";
import { getCorrelatedFiles } from "./session";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve a file path to an absolute path.
 * If the path is already absolute (starts with /), return it as-is.
 * Otherwise, join with projectPath.
 */
function resolveFilePath(projectPath: string, filePath: string): string {
  return filePath.startsWith("/") ? filePath : join(projectPath, filePath);
}

// ============================================================================
// Pre-Edit Check Command
// ============================================================================

export async function checkFiles(db: DatabaseAdapter, projectId: number, projectPath: string, files: string[]): Promise<FileCheck[]> {
  const results: FileCheck[] = [];

  for (const filePath of files) {
    const check = await checkSingleFile(db, projectId, projectPath, filePath);
    results.push(check);
  }

  displayCheckResults(results);
  outputJson(results);
  return results;
}

async function checkSingleFile(db: DatabaseAdapter, projectId: number, projectPath: string, filePath: string): Promise<FileCheck> {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  let fragility: number | undefined;
  let isStale = false;

  // Get file info from database
  const fileRecord = await db.get<{
    id: number;
    fragility: number;
    fragility_reason: string | null;
    content_hash: string | null;
    last_analyzed: string | null;
    purpose: string | null;
    dependencies: string | null;
    dependents: string | null;
  }>(`
    SELECT id, fragility, fragility_reason, content_hash, last_analyzed, purpose, dependencies, dependents
    FROM files
    WHERE project_id = ? AND path = ?
  `, [projectId, filePath]);

  if (fileRecord) {
    fragility = fileRecord.fragility;

    // Check fragility
    if (fragility >= 8) {
      warnings.push(`HIGH FRAGILITY (${fragility}/10): This file is critical. Changes may break the system.`);
      if (fileRecord.fragility_reason) {
        warnings.push(`Reason: ${fileRecord.fragility_reason}`);
      }
      suggestions.push("Consider getting a code review before modifying");
      suggestions.push("Write tests for any changes");
    } else if (fragility >= 6) {
      warnings.push(`MODERATE FRAGILITY (${fragility}/10): Handle with care.`);
      if (fileRecord.fragility_reason) {
        warnings.push(`Reason: ${fileRecord.fragility_reason}`);
      }
    }

    // Check if file has changed since last analysis
    const fullPath = resolveFilePath(projectPath, filePath);
    if (existsSync(fullPath) && fileRecord.content_hash) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const currentHash = computeContentHash(content);
        if (currentHash !== fileRecord.content_hash) {
          isStale = true;
          warnings.push("STALE: File has changed since last analysis. Consider running `muninn analyze`.");
        }
      } catch {
        // Skip hash check
      }
    }

    // Check for dependents
    if (fileRecord.dependents) {
      const dependents = safeJsonParse<string[]>(fileRecord.dependents, []);
      if (dependents.length > 0) {
        warnings.push(`Has ${dependents.length} dependent file(s). Changes may cascade.`);
        suggestions.push(
          `Review dependents: ${dependents.slice(0, 3).join(", ")}${dependents.length > 3 ? "..." : ""}`
        );
      }
    }
  } else {
    suggestions.push("File not tracked. Consider running `muninn file add` after changes.");
  }

  // Get related issues
  const relatedIssues = await db.all<{ id: number; title: string }>(`
    SELECT id, title FROM issues
    WHERE project_id = ? AND status = 'open'
    AND (affected_files LIKE ? OR related_symbols LIKE ?)
  `, [projectId, `%${filePath}%`, `%${filePath}%`]);

  if (relatedIssues.length > 0) {
    warnings.push(`${relatedIssues.length} open issue(s) related to this file`);
  }

  // Get related decisions
  const relatedDecisions = await db.all<{ id: number; title: string }>(`
    SELECT id, title FROM decisions
    WHERE project_id = ? AND status = 'active'
    AND affects LIKE ?
  `, [projectId, `%${filePath}%`]);

  if (relatedDecisions.length > 0) {
    suggestions.push(`${relatedDecisions.length} decision(s) affect this file`);
  }

  // Get correlated files (files that often change together)
  const correlations = await getCorrelatedFiles(db, projectId, filePath, 5);
  const correlatedFiles = correlations.map((c) => ({
    file: c.file,
    cochange_count: c.cochange_count,
  }));

  if (correlatedFiles.length > 0) {
    const topCorrelated = correlatedFiles
      .slice(0, 3)
      .map((c) => c.file)
      .join(", ");
    suggestions.push(`Often changes with: ${topCorrelated}`);
  }

  // Parallel: learnings + blast radius (adds ~20ms)
  const [learnings, blastResult] = await Promise.all([
    db
      .all<{ title: string; category: string; confidence: number }>(
        `SELECT title, category, confidence FROM learnings
         WHERE project_id = ? AND status = 'active'
         AND (files LIKE ? OR content LIKE ?)
         ORDER BY confidence DESC LIMIT 3`,
        [projectId, `%${filePath}%`, `%${filePath}%`]
      )
      .catch(() => [] as Array<{ title: string; category: string; confidence: number }>),
    getBlastRadius(db, projectId, projectPath, filePath).catch(() => null),
  ]);

  if (learnings.length > 0) {
    suggestions.push("Relevant learnings:");
    for (const l of learnings) {
      suggestions.push(`  [${l.category}] ${l.title} (conf:${l.confidence})`);
    }
  }

  if (blastResult && blastResult.riskLevel !== "low") {
    warnings.push(
      `Blast radius: ${blastResult.riskLevel} — ` +
        `${blastResult.directDependents.length} direct, ` +
        `${blastResult.transitiveDependents.length} transitive, ` +
        `${blastResult.affectedTests.length} tests`
    );
  }

  return {
    path: filePath,
    warnings,
    suggestions,
    fragility,
    relatedIssues,
    relatedDecisions,
    isStale,
    correlatedFiles: correlatedFiles.length > 0 ? correlatedFiles : undefined,
  };
}

function displayCheckResults(results: FileCheck[]): void {
  console.error("\n🔍 Pre-Edit Check Results:\n");

  for (const check of results) {
    const statusIcon = check.warnings.length > 0 ? "⚠️" : "✅";
    console.error(`${statusIcon} ${check.path}`);

    if (check.fragility !== undefined) {
      const fragIcon = check.fragility >= 8 ? "🔴" : check.fragility >= 6 ? "🟠" : check.fragility >= 4 ? "🟡" : "🟢";
      console.error(`   Fragility: ${fragIcon} ${check.fragility}/10`);
    }

    for (const warning of check.warnings) {
      console.error(`   ⚠️  ${warning}`);
    }

    for (const suggestion of check.suggestions) {
      console.error(`   💡 ${suggestion}`);
    }

    if (check.relatedIssues.length > 0) {
      console.error(`   🐛 Issues: ${check.relatedIssues.map((i) => `#${i.id}`).join(", ")}`);
    }

    if (check.relatedDecisions.length > 0) {
      console.error(`   📋 Decisions: ${check.relatedDecisions.map((d) => `D${d.id}`).join(", ")}`);
    }

    if (check.correlatedFiles && check.correlatedFiles.length > 0) {
      console.error(`   🔗 Often changes with:`);
      for (const corr of check.correlatedFiles.slice(0, 3)) {
        console.error(`      - ${corr.file} (${corr.cochange_count}x together)`);
      }
    }

    console.error("");
  }
}

// ============================================================================
// Impact Analysis Command
// ============================================================================

export async function analyzeImpact(db: DatabaseAdapter, projectId: number, projectPath: string, filePath: string): Promise<ImpactResult> {
  // Get blast radius data (uses BFS for full transitive analysis)
  const blastResult = await getBlastRadius(db, projectId, projectPath, filePath);

  let directDependents: string[] = [];
  let indirectDependents: string[] = [];
  let blastSummary: BlastSummary | undefined;

  if (blastResult) {
    directDependents = blastResult.directDependents;
    indirectDependents = blastResult.transitiveDependents.map((t) => t.file);
    blastSummary = blastResult.summary;
  } else {
    // Fallback to basic lookup if blast radius not available
    const fileRecord = await db.get<{
      id: number;
      dependencies: string | null;
      dependents: string | null;
    }>(`
      SELECT id, dependencies, dependents
      FROM files
      WHERE project_id = ? AND path = ?
    `, [projectId, filePath]);

    if (fileRecord) {
      directDependents = safeJsonParse<string[]>(fileRecord.dependents || "[]", []);

      // Get indirect dependents (files that depend on direct dependents)
      const indirectSet = new Set<string>();
      for (const dep of directDependents) {
        const depRecord = await db.get<{ dependents: string | null }>(`
          SELECT dependents FROM files WHERE project_id = ? AND path = ?
        `, [projectId, dep]);

        if (depRecord?.dependents) {
          const deps = safeJsonParse<string[]>(depRecord.dependents, []);
          deps.forEach((d) => {
            if (!directDependents.includes(d) && d !== filePath) {
              indirectSet.add(d);
            }
          });
        }
      }
      indirectDependents = Array.from(indirectSet);
    }
  }

  // Get decisions that affect this file
  const affectedByDecisions = await db.all<{ id: number; title: string }>(`
    SELECT id, title FROM decisions
    WHERE project_id = ? AND status = 'active' AND affects LIKE ?
  `, [projectId, `%${filePath}%`]);

  // Get related issues
  const relatedIssues = await db.all<{ id: number; title: string }>(`
    SELECT id, title FROM issues
    WHERE project_id = ? AND status = 'open'
    AND (affected_files LIKE ? OR related_symbols LIKE ?)
  `, [projectId, `%${filePath}%`, `%${filePath}%`]);

  // Suggest tests - now using blast radius data if available
  const suggestedTests: string[] = [];
  if (blastResult && blastResult.affectedTests.length > 0) {
    suggestedTests.push(`Run affected tests: ${blastResult.affectedTests.slice(0, 3).join(", ")}`);
  }
  if (filePath.includes("/components/") || filePath.includes("/routes/")) {
    suggestedTests.push(`Test UI rendering after changes`);
  }
  if (filePath.includes("/api/") || filePath.includes("/server/")) {
    suggestedTests.push(`Test API endpoints affected by this file`);
  }
  if (filePath.includes("/utils/") || filePath.includes("/lib/")) {
    suggestedTests.push(`Run unit tests for utility functions`);
  }
  if (directDependents.length > 0 && suggestedTests.length < 4) {
    suggestedTests.push(`Test dependent files: ${directDependents.slice(0, 3).join(", ")}`);
  }

  const result: ImpactResult = {
    file: filePath,
    directDependents,
    indirectDependents,
    affectedByDecisions,
    relatedIssues,
    suggestedTests,
    blastSummary,
  };

  displayImpactResult(result, blastResult);
  outputJson(result);
  return result;
}

function displayImpactResult(
  result: ImpactResult,
  blastResult?: { summary: BlastSummary; riskLevel: string; affectedTests: string[]; affectedRoutes: string[] } | null
): void {
  console.error("\n📊 Impact Analysis:\n");
  console.error(`File: ${result.file}\n`);

  // Show blast summary if available
  if (blastResult && result.blastSummary) {
    const riskEmoji =
      {
        low: "🟢",
        medium: "🟡",
        high: "🟠",
        critical: "🔴",
      }[blastResult.riskLevel] || "⚪";

    console.error(
      `🔥 Blast Radius: ${riskEmoji} ${blastResult.riskLevel.toUpperCase()} (score: ${result.blastSummary.blast_score.toFixed(1)})`
    );
    console.error(
      `   Total Affected: ${result.blastSummary.total_affected} files | Max Depth: ${result.blastSummary.max_depth} hops`
    );
    console.error(`   Tests: ${result.blastSummary.affected_tests} | Routes: ${result.blastSummary.affected_routes}`);
    console.error("");
  }

  if (result.directDependents.length > 0) {
    console.error(`📁 Direct Dependents (${result.directDependents.length}):`);
    for (const dep of result.directDependents.slice(0, 10)) {
      console.error(`   - ${dep}`);
    }
    if (result.directDependents.length > 10) {
      console.error(`   ... and ${result.directDependents.length - 10} more`);
    }
    console.error("");
  }

  if (result.indirectDependents.length > 0) {
    console.error(`📁 Transitive Dependents (${result.indirectDependents.length}):`);
    for (const dep of result.indirectDependents.slice(0, 5)) {
      console.error(`   - ${dep}`);
    }
    if (result.indirectDependents.length > 5) {
      console.error(`   ... and ${result.indirectDependents.length - 5} more`);
    }
    console.error("");
  }

  // Show affected tests from blast radius
  if (blastResult && blastResult.affectedTests.length > 0) {
    console.error(`🧪 Affected Tests (${blastResult.affectedTests.length}):`);
    for (const test of blastResult.affectedTests.slice(0, 5)) {
      console.error(`   - ${test}`);
    }
    if (blastResult.affectedTests.length > 5) {
      console.error(`   ... and ${blastResult.affectedTests.length - 5} more`);
    }
    console.error("");
  }

  // Show affected routes from blast radius
  if (blastResult && blastResult.affectedRoutes.length > 0) {
    console.error(`🌐 Affected Routes (${blastResult.affectedRoutes.length}):`);
    for (const route of blastResult.affectedRoutes.slice(0, 5)) {
      console.error(`   - ${route}`);
    }
    if (blastResult.affectedRoutes.length > 5) {
      console.error(`   ... and ${blastResult.affectedRoutes.length - 5} more`);
    }
    console.error("");
  }

  if (result.affectedByDecisions.length > 0) {
    console.error(`📋 Related Decisions:`);
    for (const dec of result.affectedByDecisions) {
      console.error(`   - D${dec.id}: ${dec.title}`);
    }
    console.error("");
  }

  if (result.relatedIssues.length > 0) {
    console.error(`🐛 Related Issues:`);
    for (const issue of result.relatedIssues) {
      console.error(`   - #${issue.id}: ${issue.title}`);
    }
    console.error("");
  }

  if (result.suggestedTests.length > 0) {
    console.error(`✅ Suggested Tests:`);
    for (const test of result.suggestedTests) {
      console.error(`   - ${test}`);
    }
    console.error("");
  }
}

// ============================================================================
// Smart Status Command
// ============================================================================

export async function getSmartStatus(db: DatabaseAdapter, projectId: number, projectPath: string): Promise<SmartStatus> {
  const actions: Array<{ priority: number; action: string; reason: string }> = [];
  const warnings: string[] = [];

  // Check for critical issues
  const criticalIssues = await db.all<{ id: number; title: string; severity: number }>(`
    SELECT id, title, severity FROM issues
    WHERE project_id = ? AND status = 'open' AND severity >= 8
    ORDER BY severity DESC
  `, [projectId]);

  for (const issue of criticalIssues) {
    actions.push({
      priority: 1,
      action: `Fix issue #${issue.id}: ${issue.title}`,
      reason: `Critical severity (${issue.severity}/10)`,
    });
  }

  // Check for stale files
  const staleFiles = await findStaleFiles(db, projectId, projectPath);
  if (staleFiles.length > 0) {
    actions.push({
      priority: 2,
      action: `Update knowledge for ${staleFiles.length} stale file(s)`,
      reason: "Files have changed since last analysis",
    });
    warnings.push(`${staleFiles.length} file(s) have outdated knowledge`);
  }

  // Check for ongoing session
  const ongoingSession = await db.get<{ id: number; goal: string; started_at: string }>(`
    SELECT id, goal, started_at FROM sessions
    WHERE project_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `, [projectId]);

  if (ongoingSession) {
    warnings.push(`Session #${ongoingSession.id} still in progress: "${ongoingSession.goal}"`);
  }

  // Check for high fragility files recently modified (git)
  // M1: Add timeout to prevent hangs from malicious/corrupted repos
  try {
    const gitChanges = execSync("git diff --name-only HEAD~5 2>/dev/null || echo ''", {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 10000, // 10 second timeout
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    const fragileFiles = await db.all<{ path: string; fragility: number }>(`
      SELECT path, fragility FROM files
      WHERE project_id = ? AND fragility >= 7
    `, [projectId]);

    const fragileChanged = fragileFiles.filter((f) => gitChanges.includes(f.path));

    if (fragileChanged.length > 0) {
      warnings.push(`${fragileChanged.length} fragile file(s) recently modified`);
      actions.push({
        priority: 2,
        action: "Review recent changes to fragile files",
        reason: `${fragileChanged.map((f) => f.path).join(", ")} modified`,
      });
    }
  } catch {
    // Git not available
  }

  // Check for pending next steps from last session
  const lastSession = await db.get<{ next_steps: string | null }>(`
    SELECT next_steps FROM sessions
    WHERE project_id = ? AND ended_at IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT 1
  `, [projectId]);

  if (lastSession?.next_steps) {
    actions.push({
      priority: 3,
      action: lastSession.next_steps.substring(0, 100),
      reason: "Pending from last session",
    });
  }

  // Check for tech debt
  const techDebt = await db.all<{ id: number; title: string; severity: number }>(`
    SELECT id, title, severity FROM issues
    WHERE project_id = ? AND type = 'tech-debt' AND status = 'open'
    ORDER BY severity DESC
    LIMIT 3
  `, [projectId]);

  if (techDebt.length > 0) {
    actions.push({
      priority: 4,
      action: `Address tech debt: ${techDebt.map((d) => d.title).join(", ")}`,
      reason: `${techDebt.length} item(s) tracked`,
    });
  }

  // Calculate project health
  const projectHealth = await calculateProjectHealth(db, projectId, criticalIssues.length, staleFiles.length);

  // Generate summary
  const summary = generateStatusSummary(projectHealth, actions.length, warnings.length);

  const result: SmartStatus = {
    summary,
    actions: actions.sort((a, b) => a.priority - b.priority),
    warnings,
    projectHealth,
  };

  displaySmartStatus(result);
  outputJson(result);
  return result;
}

async function findStaleFiles(db: DatabaseAdapter, projectId: number, projectPath: string): Promise<StaleFile[]> {
  const staleFiles: StaleFile[] = [];

  const trackedFiles = await db.all<{
    path: string;
    content_hash: string | null;
    last_analyzed: string | null;
    fs_modified_at: string | null;
  }>(`
    SELECT path, content_hash, last_analyzed, fs_modified_at
    FROM files
    WHERE project_id = ? AND status = 'active'
  `, [projectId]);

  for (const file of trackedFiles) {
    const fullPath = resolveFilePath(projectPath, file.path);

    if (!existsSync(fullPath)) {
      staleFiles.push({
        path: file.path,
        lastAnalyzed: file.last_analyzed || "never",
        fsModified: "deleted",
        status: "missing",
        reason: "File no longer exists on disk",
      });
      continue;
    }

    if (file.content_hash) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const currentHash = computeContentHash(content);
        if (currentHash !== file.content_hash) {
          const stat = statSync(fullPath);
          staleFiles.push({
            path: file.path,
            lastAnalyzed: file.last_analyzed || "never",
            fsModified: stat.mtime.toISOString(),
            status: "stale",
            reason: "Content has changed since last analysis",
          });
        }
      } catch {
        // Skip file
      }
    }
  }

  return staleFiles;
}

async function calculateProjectHealth(
  db: DatabaseAdapter,
  projectId: number,
  criticalCount: number,
  staleCount: number
): Promise<ProjectHealth> {
  if (criticalCount > 0) return "critical";

  const openIssuesResult = await db.get<{ count: number }>(`
    SELECT COUNT(*) as count FROM issues
    WHERE project_id = ? AND status = 'open' AND severity >= 5
  `, [projectId]);
  const openIssues = openIssuesResult?.count || 0;

  const highFragilityResult = await db.get<{ count: number }>(`
    SELECT COUNT(*) as count FROM files
    WHERE project_id = ? AND fragility >= 8
  `, [projectId]);
  const highFragilityFiles = highFragilityResult?.count || 0;

  if (openIssues > 5 || staleCount > 10 || highFragilityFiles > 5) {
    return "attention";
  }

  return "good";
}

function generateStatusSummary(health: ProjectHealth, actionCount: number, warningCount: number): string {
  const healthEmoji = health === "good" ? "🟢" : health === "attention" ? "🟡" : "🔴";

  if (health === "critical") {
    return `${healthEmoji} Critical issues need immediate attention. ${actionCount} action(s) recommended.`;
  } else if (health === "attention") {
    return `${healthEmoji} Project needs attention. ${actionCount} action(s) pending, ${warningCount} warning(s).`;
  } else {
    return `${healthEmoji} Project is healthy. ${actionCount > 0 ? `${actionCount} suggested action(s).` : "No urgent actions needed."}`;
  }
}

function displaySmartStatus(status: SmartStatus): void {
  console.error("\n📊 Smart Status:\n");
  console.error(`${status.summary}\n`);

  if (status.warnings.length > 0) {
    console.error("⚠️  Warnings:");
    for (const warning of status.warnings) {
      console.error(`   - ${warning}`);
    }
    console.error("");
  }

  if (status.actions.length > 0) {
    console.error("📋 Recommended Actions:");
    for (const action of status.actions) {
      const priorityIcon = action.priority === 1 ? "🔴" : action.priority === 2 ? "🟠" : "🟡";
      console.error(`   ${priorityIcon} [P${action.priority}] ${action.action}`);
      console.error(`      Reason: ${action.reason}`);
    }
    console.error("");
  }
}

// ============================================================================
// Conflict Detection Command
// ============================================================================

export async function checkConflicts(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  files: string[]
): Promise<Array<{ path: string; hasConflict: boolean; reason: string }>> {
  const results: Array<{ path: string; hasConflict: boolean; reason: string }> = [];

  for (const filePath of files) {
    const fileRecord = await db.get<{
      last_queried_at: string | null;
      content_hash: string | null;
    }>(`
      SELECT last_queried_at, content_hash FROM files
      WHERE project_id = ? AND path = ?
    `, [projectId, filePath]);

    if (!fileRecord) {
      results.push({
        path: filePath,
        hasConflict: false,
        reason: "File not tracked",
      });
      continue;
    }

    const fullPath = resolveFilePath(projectPath, filePath);
    if (!existsSync(fullPath)) {
      results.push({
        path: filePath,
        hasConflict: true,
        reason: "File has been deleted",
      });
      continue;
    }

    if (fileRecord.content_hash) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const currentHash = computeContentHash(content);
        if (currentHash !== fileRecord.content_hash) {
          results.push({
            path: filePath,
            hasConflict: true,
            reason: fileRecord.last_queried_at
              ? `Modified since last query (${fileRecord.last_queried_at})`
              : "Modified since last analysis",
          });
          continue;
        }
      } catch {
        // Skip
      }
    }

    results.push({
      path: filePath,
      hasConflict: false,
      reason: "No changes detected",
    });
  }

  displayConflictResults(results);
  outputJson(results);
  return results;
}

function displayConflictResults(results: Array<{ path: string; hasConflict: boolean; reason: string }>): void {
  console.error("\n🔍 Conflict Check:\n");

  for (const result of results) {
    const icon = result.hasConflict ? "⚠️" : "✅";
    console.error(`${icon} ${result.path}: ${result.reason}`);
  }
  console.error("");
}
