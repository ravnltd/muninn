/**
 * Intelligence commands
 * Smart status, pre-edit checks, impact analysis
 */

import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type {
  FileCheck,
  ImpactResult,
  SmartStatus,
  ProjectHealth,
  StaleFile,
} from "../types";
import { outputJson, computeContentHash } from "../utils/format";
import { safeJsonParse } from "../utils/errors";
import { getCorrelatedFiles } from "./session";

// ============================================================================
// Pre-Edit Check Command
// ============================================================================

export function checkFiles(
  db: Database,
  projectId: number,
  projectPath: string,
  files: string[]
): FileCheck[] {
  const results: FileCheck[] = [];

  for (const filePath of files) {
    const check = checkSingleFile(db, projectId, projectPath, filePath);
    results.push(check);
  }

  displayCheckResults(results);
  outputJson(results);
  return results;
}

function checkSingleFile(
  db: Database,
  projectId: number,
  projectPath: string,
  filePath: string
): FileCheck {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  let fragility: number | undefined;
  let isStale = false;

  // Get file info from database
  const fileRecord = db.query<{
    id: number;
    fragility: number;
    fragility_reason: string | null;
    content_hash: string | null;
    last_analyzed: string | null;
    purpose: string | null;
    dependencies: string | null;
    dependents: string | null;
  }, [number, string]>(`
    SELECT id, fragility, fragility_reason, content_hash, last_analyzed, purpose, dependencies, dependents
    FROM files
    WHERE project_id = ? AND path = ?
  `).get(projectId, filePath);

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
    const fullPath = join(projectPath, filePath);
    if (existsSync(fullPath) && fileRecord.content_hash) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const currentHash = computeContentHash(content);
        if (currentHash !== fileRecord.content_hash) {
          isStale = true;
          warnings.push("STALE: File has changed since last analysis. Consider running `context analyze`.");
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
        suggestions.push(`Review dependents: ${dependents.slice(0, 3).join(", ")}${dependents.length > 3 ? "..." : ""}`);
      }
    }
  } else {
    suggestions.push("File not tracked. Consider running `context file add` after changes.");
  }

  // Get related issues
  const relatedIssues = db.query<{ id: number; title: string }, [number, string, string]>(`
    SELECT id, title FROM issues
    WHERE project_id = ? AND status = 'open'
    AND (affected_files LIKE ? OR related_symbols LIKE ?)
  `).all(projectId, `%${filePath}%`, `%${filePath}%`);

  if (relatedIssues.length > 0) {
    warnings.push(`${relatedIssues.length} open issue(s) related to this file`);
  }

  // Get related decisions
  const relatedDecisions = db.query<{ id: number; title: string }, [number, string]>(`
    SELECT id, title FROM decisions
    WHERE project_id = ? AND status = 'active'
    AND affects LIKE ?
  `).all(projectId, `%${filePath}%`);

  if (relatedDecisions.length > 0) {
    suggestions.push(`${relatedDecisions.length} decision(s) affect this file`);
  }

  // Get correlated files (files that often change together)
  const correlations = getCorrelatedFiles(db, projectId, filePath, 5);
  const correlatedFiles = correlations.map(c => ({
    file: c.file,
    cochange_count: c.cochange_count
  }));

  if (correlatedFiles.length > 0) {
    const topCorrelated = correlatedFiles.slice(0, 3).map(c => c.file).join(", ");
    suggestions.push(`Often changes with: ${topCorrelated}`);
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
      console.error(`   🐛 Issues: ${check.relatedIssues.map(i => `#${i.id}`).join(", ")}`);
    }

    if (check.relatedDecisions.length > 0) {
      console.error(`   📋 Decisions: ${check.relatedDecisions.map(d => `D${d.id}`).join(", ")}`);
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

export function analyzeImpact(
  db: Database,
  projectId: number,
  _projectPath: string,
  filePath: string
): ImpactResult {
  // Get file info
  const fileRecord = db.query<{
    id: number;
    dependencies: string | null;
    dependents: string | null;
  }, [number, string]>(`
    SELECT id, dependencies, dependents
    FROM files
    WHERE project_id = ? AND path = ?
  `).get(projectId, filePath);

  let directDependents: string[] = [];
  let indirectDependents: string[] = [];

  if (fileRecord) {
    directDependents = safeJsonParse<string[]>(fileRecord.dependents || "[]", []);

    // Get indirect dependents (files that depend on direct dependents)
    const indirectSet = new Set<string>();
    for (const dep of directDependents) {
      const depRecord = db.query<{ dependents: string | null }, [number, string]>(`
        SELECT dependents FROM files WHERE project_id = ? AND path = ?
      `).get(projectId, dep);

      if (depRecord?.dependents) {
        const deps = safeJsonParse<string[]>(depRecord.dependents, []);
        deps.forEach(d => {
          if (!directDependents.includes(d) && d !== filePath) {
            indirectSet.add(d);
          }
        });
      }
    }
    indirectDependents = Array.from(indirectSet);
  }

  // Get decisions that affect this file
  const affectedByDecisions = db.query<{ id: number; title: string }, [number, string]>(`
    SELECT id, title FROM decisions
    WHERE project_id = ? AND status = 'active' AND affects LIKE ?
  `).all(projectId, `%${filePath}%`);

  // Get related issues
  const relatedIssues = db.query<{ id: number; title: string }, [number, string, string]>(`
    SELECT id, title FROM issues
    WHERE project_id = ? AND status = 'open'
    AND (affected_files LIKE ? OR related_symbols LIKE ?)
  `).all(projectId, `%${filePath}%`, `%${filePath}%`);

  // Suggest tests based on file type
  const suggestedTests: string[] = [];
  if (filePath.includes("/components/") || filePath.includes("/routes/")) {
    suggestedTests.push(`Test UI rendering after changes`);
  }
  if (filePath.includes("/api/") || filePath.includes("/server/")) {
    suggestedTests.push(`Test API endpoints affected by this file`);
  }
  if (filePath.includes("/utils/") || filePath.includes("/lib/")) {
    suggestedTests.push(`Run unit tests for utility functions`);
  }
  if (directDependents.length > 0) {
    suggestedTests.push(`Test dependent files: ${directDependents.slice(0, 3).join(", ")}`);
  }

  const result: ImpactResult = {
    file: filePath,
    directDependents,
    indirectDependents,
    affectedByDecisions,
    relatedIssues,
    suggestedTests,
  };

  displayImpactResult(result);
  outputJson(result);
  return result;
}

function displayImpactResult(result: ImpactResult): void {
  console.error("\n📊 Impact Analysis:\n");
  console.error(`File: ${result.file}\n`);

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
    console.error(`📁 Indirect Dependents (${result.indirectDependents.length}):`);
    for (const dep of result.indirectDependents.slice(0, 5)) {
      console.error(`   - ${dep}`);
    }
    if (result.indirectDependents.length > 5) {
      console.error(`   ... and ${result.indirectDependents.length - 5} more`);
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

export function getSmartStatus(
  db: Database,
  projectId: number,
  projectPath: string
): SmartStatus {
  const actions: Array<{ priority: number; action: string; reason: string }> = [];
  const warnings: string[] = [];

  // Check for critical issues
  const criticalIssues = db.query<{ id: number; title: string; severity: number }, [number]>(`
    SELECT id, title, severity FROM issues
    WHERE project_id = ? AND status = 'open' AND severity >= 8
    ORDER BY severity DESC
  `).all(projectId);

  for (const issue of criticalIssues) {
    actions.push({
      priority: 1,
      action: `Fix issue #${issue.id}: ${issue.title}`,
      reason: `Critical severity (${issue.severity}/10)`,
    });
  }

  // Check for stale files
  const staleFiles = findStaleFiles(db, projectId, projectPath);
  if (staleFiles.length > 0) {
    actions.push({
      priority: 2,
      action: `Update knowledge for ${staleFiles.length} stale file(s)`,
      reason: "Files have changed since last analysis",
    });
    warnings.push(`${staleFiles.length} file(s) have outdated knowledge`);
  }

  // Check for ongoing session
  const ongoingSession = db.query<{ id: number; goal: string; started_at: string }, [number]>(`
    SELECT id, goal, started_at FROM sessions
    WHERE project_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `).get(projectId);

  if (ongoingSession) {
    warnings.push(`Session #${ongoingSession.id} still in progress: "${ongoingSession.goal}"`);
  }

  // Check for high fragility files recently modified (git)
  try {
    const gitChanges = execSync("git diff --name-only HEAD~5 2>/dev/null || echo ''", {
      cwd: projectPath,
      encoding: "utf-8",
    }).trim().split("\n").filter(Boolean);

    const fragileChanged = db.query<{ path: string; fragility: number }, [number]>(`
      SELECT path, fragility FROM files
      WHERE project_id = ? AND fragility >= 7
    `).all(projectId).filter(f => gitChanges.includes(f.path));

    if (fragileChanged.length > 0) {
      warnings.push(`${fragileChanged.length} fragile file(s) recently modified`);
      actions.push({
        priority: 2,
        action: "Review recent changes to fragile files",
        reason: `${fragileChanged.map(f => f.path).join(", ")} modified`,
      });
    }
  } catch {
    // Git not available
  }

  // Check for pending next steps from last session
  const lastSession = db.query<{ next_steps: string | null }, [number]>(`
    SELECT next_steps FROM sessions
    WHERE project_id = ? AND ended_at IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT 1
  `).get(projectId);

  if (lastSession?.next_steps) {
    actions.push({
      priority: 3,
      action: lastSession.next_steps.substring(0, 100),
      reason: "Pending from last session",
    });
  }

  // Check for tech debt
  const techDebt = db.query<{ id: number; title: string; severity: number }, [number]>(`
    SELECT id, title, severity FROM issues
    WHERE project_id = ? AND type = 'tech-debt' AND status = 'open'
    ORDER BY severity DESC
    LIMIT 3
  `).all(projectId);

  if (techDebt.length > 0) {
    actions.push({
      priority: 4,
      action: `Address tech debt: ${techDebt.map(d => d.title).join(", ")}`,
      reason: `${techDebt.length} item(s) tracked`,
    });
  }

  // Calculate project health
  const projectHealth = calculateProjectHealth(db, projectId, criticalIssues.length, staleFiles.length);

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

function findStaleFiles(
  db: Database,
  projectId: number,
  projectPath: string
): StaleFile[] {
  const staleFiles: StaleFile[] = [];

  const trackedFiles = db.query<{
    path: string;
    content_hash: string | null;
    last_analyzed: string | null;
    fs_modified_at: string | null;
  }, [number]>(`
    SELECT path, content_hash, last_analyzed, fs_modified_at
    FROM files
    WHERE project_id = ? AND status = 'active'
  `).all(projectId);

  for (const file of trackedFiles) {
    const fullPath = join(projectPath, file.path);

    if (!existsSync(fullPath)) {
      staleFiles.push({
        path: file.path,
        lastAnalyzed: file.last_analyzed || "never",
        fsModified: "deleted",
        status: "missing",
        reason: "File no longer exists",
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

function calculateProjectHealth(
  db: Database,
  projectId: number,
  criticalCount: number,
  staleCount: number
): ProjectHealth {
  if (criticalCount > 0) return "critical";

  const openIssues = db.query<{ count: number }, [number]>(`
    SELECT COUNT(*) as count FROM issues
    WHERE project_id = ? AND status = 'open' AND severity >= 5
  `).get(projectId)?.count || 0;

  const highFragilityFiles = db.query<{ count: number }, [number]>(`
    SELECT COUNT(*) as count FROM files
    WHERE project_id = ? AND fragility >= 8
  `).get(projectId)?.count || 0;

  if (openIssues > 5 || staleCount > 10 || highFragilityFiles > 5) {
    return "attention";
  }

  return "good";
}

function generateStatusSummary(
  health: ProjectHealth,
  actionCount: number,
  warningCount: number
): string {
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

export function checkConflicts(
  db: Database,
  projectId: number,
  projectPath: string,
  files: string[]
): Array<{ path: string; hasConflict: boolean; reason: string }> {
  const results: Array<{ path: string; hasConflict: boolean; reason: string }> = [];

  for (const filePath of files) {
    const fileRecord = db.query<{
      last_queried_at: string | null;
      content_hash: string | null;
    }, [number, string]>(`
      SELECT last_queried_at, content_hash FROM files
      WHERE project_id = ? AND path = ?
    `).get(projectId, filePath);

    if (!fileRecord) {
      results.push({
        path: filePath,
        hasConflict: false,
        reason: "File not tracked",
      });
      continue;
    }

    const fullPath = join(projectPath, filePath);
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

function displayConflictResults(
  results: Array<{ path: string; hasConflict: boolean; reason: string }>
): void {
  console.error("\n🔍 Conflict Check:\n");

  for (const result of results) {
    const icon = result.hasConflict ? "⚠️" : "✅";
    console.error(`${icon} ${result.path}: ${result.reason}`);
  }
  console.error("");
}
