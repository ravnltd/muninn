// @muninn — context in .muninn/context/
/**
 * Hook commands
 * Optimized for automation with proper exit codes and concise output
 * These commands are designed to be called by MCP client hooks
 */

import type { DatabaseAdapter } from "../database/adapter";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeContentHash } from "../utils/format";

// ============================================================================
// Types
// ============================================================================

interface HookCheckResult {
  blocked: boolean;
  reason: string | null;
  files: Array<{
    path: string;
    fragility: number;
    warnings: string[];
  }>;
}

interface HookInitResult {
  hasContext: boolean;
  lastSession: {
    goal: string;
    timeAgo: string;
    outcome: string | null;
    nextSteps: string | null;
  } | null;
  health: "good" | "attention" | "critical";
  warnings: string[];
  topAction: string | null;
}

// ============================================================================
// Hook Check Command
// Pre-edit check that exits 1 if fragility >= threshold
// ============================================================================

export async function hookCheck(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  files: string[],
  threshold: number = 7
): Promise<HookCheckResult> {
  const result: HookCheckResult = {
    blocked: false,
    reason: null,
    files: [],
  };

  let maxFragility = 0;
  let blockingFile: string | null = null;

  for (const filePath of files) {
    const fileRecord = await db.get<{
      fragility: number;
      fragility_reason: string | null;
      content_hash: string | null;
    }>(
      `SELECT fragility, fragility_reason, content_hash
       FROM files
       WHERE project_id = ? AND path = ?`,
      [projectId, filePath]
    );

    const warnings: string[] = [];
    let fragility = 0;

    if (fileRecord) {
      fragility = fileRecord.fragility;

      if (fragility >= threshold) {
        if (fragility > maxFragility) {
          maxFragility = fragility;
          blockingFile = filePath;
        }
        warnings.push(`Fragility ${fragility}/10`);
        if (fileRecord.fragility_reason) {
          warnings.push(fileRecord.fragility_reason);
        }
      }

      // Check staleness
      const fullPath = join(projectPath, filePath);
      if (existsSync(fullPath) && fileRecord.content_hash) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          const currentHash = computeContentHash(content);
          if (currentHash !== fileRecord.content_hash) {
            warnings.push("Stale: content changed since last analysis");
          }
        } catch {
          // Skip
        }
      }
    }

    // Check for related issues
    const issues = await db.all<{ id: number }>(
      `SELECT id FROM issues
       WHERE project_id = ? AND status = 'open' AND severity >= 7
       AND (affected_files LIKE ? OR related_symbols LIKE ?)`,
      [projectId, `%${filePath}%`, `%${filePath}%`]
    );

    if (issues.length > 0) {
      warnings.push(`${issues.length} critical issue(s) affect this file`);
    }

    result.files.push({ path: filePath, fragility, warnings });
  }

  if (maxFragility >= threshold && blockingFile) {
    result.blocked = true;
    result.reason = `⚠️ ${blockingFile} has fragility ${maxFragility}/10 (threshold: ${threshold}). Explain your approach before editing.`;
  }

  // Output for hooks
  if (result.blocked) {
    console.error(`\n🛑 BLOCKED: ${result.reason}\n`);
    for (const f of result.files.filter((f) => f.fragility >= threshold)) {
      console.error(`   📁 ${f.path} (fragility: ${f.fragility}/10)`);
      for (const w of f.warnings) {
        console.error(`      - ${w}`);
      }
    }
    console.error("\nTo proceed, explain your approach in your message.\n");
  } else {
    // Silent success for non-blocking
    if (result.files.some((f) => f.warnings.length > 0)) {
      console.error(`\n✅ Pre-edit check passed with notes:`);
      for (const f of result.files.filter((f) => f.warnings.length > 0)) {
        console.error(`   📁 ${f.path}: ${f.warnings.join(", ")}`);
      }
      console.error("");
    }
  }

  // Output JSON to stdout
  console.log(JSON.stringify(result));

  // Exit with code 1 if blocked (for hook blocking)
  if (result.blocked) {
    process.exit(1);
  }

  return result;
}

// ============================================================================
// Hook Init Command
// Returns session initialization context
// ============================================================================

export async function hookInit(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string
): Promise<HookInitResult> {
  const result: HookInitResult = {
    hasContext: false,
    lastSession: null,
    health: "good",
    warnings: [],
    topAction: null,
  };

  // Get last session
  const session = await db.get<{
    goal: string;
    outcome: string | null;
    next_steps: string | null;
    ended_at: string | null;
    started_at: string;
  }>(
    `SELECT goal, outcome, next_steps, ended_at, started_at
     FROM sessions
     WHERE project_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [projectId]
  );

  if (session) {
    result.hasContext = true;
    const timestamp = session.ended_at || session.started_at;
    result.lastSession = {
      goal: session.goal,
      timeAgo: getTimeAgo(timestamp),
      outcome: session.outcome,
      nextSteps: session.next_steps,
    };
  }

  // Check project health
  const criticalIssues = await db.all<{ id: number }>(
    `SELECT id FROM issues
     WHERE project_id = ? AND status = 'open' AND severity >= 8`,
    [projectId]
  );

  if (criticalIssues.length > 0) {
    result.health = "critical";
    result.warnings.push(`${criticalIssues.length} critical issue(s)`);
  }

  // Check for stale files
  const staleCount = await countStaleFiles(db, projectId, projectPath);
  if (staleCount > 0) {
    result.warnings.push(`${staleCount} stale file(s)`);
    if (result.health === "good") result.health = "attention";
  }

  // Get top action
  if (criticalIssues.length > 0) {
    const topIssue = await db.get<{ id: number; title: string }>(
      `SELECT id, title FROM issues
       WHERE project_id = ? AND status = 'open' AND severity >= 8
       ORDER BY severity DESC
       LIMIT 1`,
      [projectId]
    );
    if (topIssue) {
      result.topAction = `Fix #${topIssue.id}: ${topIssue.title}`;
    }
  } else if (session?.next_steps) {
    result.topAction = session.next_steps.substring(0, 80);
  }

  // Output human-readable to stderr
  outputInitContext(result);

  // Output JSON to stdout
  console.log(JSON.stringify(result));

  return result;
}

function outputInitContext(result: HookInitResult): void {
  const healthEmoji = result.health === "good" ? "🟢" : result.health === "attention" ? "🟡" : "🔴";

  console.error(`\n${healthEmoji} Muninn Initialized\n`);

  if (result.lastSession) {
    console.error(`📋 Last Session (${result.lastSession.timeAgo}):`);
    console.error(`   Goal: ${result.lastSession.goal}`);
    if (result.lastSession.outcome) {
      console.error(`   Outcome: ${result.lastSession.outcome}`);
    }
    if (result.lastSession.nextSteps) {
      console.error(`   Next: ${result.lastSession.nextSteps.substring(0, 60)}...`);
    }
    console.error("");
  }

  if (result.warnings.length > 0) {
    console.error(`⚠️  Warnings: ${result.warnings.join(", ")}`);
    console.error("");
  }

  if (result.topAction) {
    console.error(`📌 Top Priority: ${result.topAction}`);
    console.error("");
  }
}

// ============================================================================
// Hook Post-Edit Command
// Returns reminder to update memory
// ============================================================================

export async function hookPostEdit(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<void> {
  // Check if file is tracked
  const fileRecord = await db.get<{ id: number; fragility: number }>(
    `SELECT id, fragility FROM files
     WHERE project_id = ? AND path = ?`,
    [projectId, filePath]
  );

  if (!fileRecord) {
    console.error(`\n💡 New file modified: ${filePath}`);
    console.error(`   Consider: muninn file add "${filePath}" --purpose "..." --fragility 5`);
    console.error("");
  } else if (fileRecord.fragility >= 6) {
    console.error(`\n💡 Fragile file modified: ${filePath} (fragility: ${fileRecord.fragility}/10)`);
    console.error(`   Consider: muninn_decision_add if you made architectural changes`);
    console.error("");
  }

  // Track the edit in active session
  const activeSession = await db.get<{ id: number }>(
    `SELECT id FROM sessions
     WHERE project_id = ? AND ended_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1`,
    [projectId]
  );
  const sessionId = activeSession?.id;

  if (sessionId) {
    // Update files_touched in session
    const session = await db.get<{ files_touched: string | null }>(
      `SELECT files_touched FROM sessions WHERE id = ?`,
      [sessionId]
    );

    const filesTouched = JSON.parse(session?.files_touched || "[]") as string[];
    if (!filesTouched.includes(filePath)) {
      filesTouched.push(filePath);
      await db.run(`UPDATE sessions SET files_touched = ? WHERE id = ?`, [
        JSON.stringify(filesTouched),
        sessionId,
      ]);
    }
  }

  console.log(JSON.stringify({ tracked: !!sessionId, isNew: !fileRecord }));
}

// ============================================================================
// Hook Brain Command
// Comprehensive brain dump for session start
// ============================================================================

export async function hookBrain(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string
): Promise<void> {
  console.error("\n🧠 Loading Brain...\n");

  // 1. Resume point
  const session = await db.get<{
    goal: string;
    outcome: string | null;
    next_steps: string | null;
    started_at: string;
  }>(
    `SELECT goal, outcome, next_steps, started_at
     FROM sessions
     WHERE project_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [projectId]
  );

  if (session) {
    const timeAgo = getTimeAgo(session.started_at);
    console.error(`📋 Last Session (${timeAgo}): ${session.goal}`);
    if (session.next_steps) {
      console.error(`   ➡️  Next: ${session.next_steps.substring(0, 80)}`);
    }
    console.error("");
  }

  // 2. Critical issues
  const issues = await db.all<{ id: number; title: string; severity: number }>(
    `SELECT id, title, severity FROM issues
     WHERE project_id = ? AND status = 'open' AND severity >= 7
     ORDER BY severity DESC
     LIMIT 3`,
    [projectId]
  );

  if (issues.length > 0) {
    console.error(`🔴 Critical Issues:`);
    for (const i of issues) {
      console.error(`   #${i.id} (${i.severity}/10): ${i.title}`);
    }
    console.error("");
  }

  // 3. Fragile files
  const fragile = await db.all<{ path: string; fragility: number }>(
    `SELECT path, fragility FROM files
     WHERE project_id = ? AND fragility >= 7
     ORDER BY fragility DESC
     LIMIT 5`,
    [projectId]
  );

  if (fragile.length > 0) {
    console.error(`⚠️  Fragile Files:`);
    for (const f of fragile) {
      console.error(`   ${f.path} (${f.fragility}/10)`);
    }
    console.error("");
  }

  // 4. Recent decisions
  const decisions = await db.all<{ id: number; title: string }>(
    `SELECT id, title FROM decisions
     WHERE project_id = ? AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 3`,
    [projectId]
  );

  if (decisions.length > 0) {
    console.error(`📝 Recent Decisions:`);
    for (const d of decisions) {
      console.error(`   D${d.id}: ${d.title}`);
    }
    console.error("");
  }

  // 5. Stale file count
  const staleCount = await countStaleFiles(db, projectId, projectPath);
  if (staleCount > 0) {
    console.error(`📊 ${staleCount} file(s) have drifted since last analysis`);
    console.error("");
  }

  console.error("Ready. Use muninn_query to search, muninn_check before editing.\n");
}

// ============================================================================
// Hook Read-Context Command
// Post-read injection — only speaks when there's something non-obvious
// ============================================================================

interface ReadContextLine {
  type: "fragility" | "issue" | "decision" | "cochange";
  text: string;
}

export async function hookReadContext(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<void> {
  const lines: ReadContextLine[] = [];

  // Run all queries in parallel
  const [fileRecord, issues, decisions, cochangersA, cochangersB] =
    await Promise.all([
      db.get<{
        fragility: number;
        fragility_reason: string | null;
      }>(
        `SELECT fragility, fragility_reason FROM files
         WHERE project_id = ? AND path = ?`,
        [projectId, filePath]
      ),
      db.all<{ id: number; title: string; severity: number }>(
        `SELECT id, title, severity FROM issues
         WHERE project_id = ? AND status = 'open'
         AND (affected_files LIKE ? OR related_symbols LIKE ?)
         ORDER BY severity DESC LIMIT 2`,
        [projectId, `%${filePath}%`, `%${filePath}%`]
      ),
      db.all<{ id: number; title: string }>(
        `SELECT id, title FROM decisions
         WHERE project_id = ? AND status = 'active'
         AND affects LIKE ?
         ORDER BY created_at DESC LIMIT 2`,
        [projectId, `%${filePath}%`]
      ),
      db.all<{ file_b: string; cochange_count: number }>(
        `SELECT file_b, cochange_count FROM file_correlations
         WHERE project_id = ? AND file_a = ? AND cochange_count >= 3
         ORDER BY cochange_count DESC LIMIT 3`,
        [projectId, filePath]
      ),
      db.all<{ file_a: string; cochange_count: number }>(
        `SELECT file_a, cochange_count FROM file_correlations
         WHERE project_id = ? AND file_b = ? AND cochange_count >= 3
         ORDER BY cochange_count DESC LIMIT 3`,
        [projectId, filePath]
      ),
    ]);

  // Fragility (only surface if >= 5)
  if (fileRecord && fileRecord.fragility >= 5) {
    const reason = fileRecord.fragility_reason
      ? ` — ${fileRecord.fragility_reason}`
      : "";
    lines.push({
      type: "fragility",
      text: `FRAGILITY ${fileRecord.fragility}/10${reason}`,
    });
  }

  // Open issues
  for (const issue of issues) {
    lines.push({
      type: "issue",
      text: `ISSUE #${issue.id}: ${issue.title} (sev ${issue.severity})`,
    });
  }

  // Constraining decisions
  for (const d of decisions) {
    lines.push({
      type: "decision",
      text: `DECISION D${d.id}: ${d.title}`,
    });
  }

  // Co-changers (merge both directions, filter to project-relative paths)
  const cochangers = [
    ...cochangersA.map((c) => ({ path: c.file_b, count: c.cochange_count })),
    ...cochangersB.map((c) => ({ path: c.file_a, count: c.cochange_count })),
  ]
    .filter((c) => !c.path.startsWith("/") && !c.path.startsWith("."))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Only show co-changers if there's already a signal, or correlation is very strong
  const hasOtherSignal = lines.length > 0;
  if (cochangers.length > 0 && (hasOtherSignal || cochangers[0].count >= 5)) {
    lines.push({
      type: "cochange",
      text: `CO-CHANGES WITH: ${cochangers.map((c) => c.path).join(", ")}`,
    });
  }

  // Only output if we have something worth saying
  if (lines.length === 0) return;

  // Output to stdout (injected into Claude's context)
  const output = [`[muninn:${filePath}]`];
  for (const line of lines) {
    output.push(`  ${line.text}`);
  }
  console.log(output.join("\n"));
}

// ============================================================================
// Hook Project Brief Command
// Lightweight project orientation for session start
// ============================================================================

interface ProjectBrief {
  hotFiles: Array<{ path: string; fragility: number }>;
  activeDecisions: Array<{ id: number; title: string }>;
  openIssueCount: number;
  recentGoals: string[];
  foundationalLearnings: Array<{ title: string; content: string }>;
}

export async function hookProjectBrief(
  db: DatabaseAdapter,
  projectId: number
): Promise<ProjectBrief> {
  const [hotFiles, activeDecisions, openIssueCount, recentSessions, foundational] =
    await Promise.all([
      // Hot/warm files first, fallback to high-fragility recently-referenced files
      db.all<{ path: string; fragility: number }>(
        `SELECT path, fragility FROM files
         WHERE project_id = ? AND (
           temperature IN ('hot', 'warm')
           OR (fragility >= 7 AND last_referenced_at IS NOT NULL)
         )
         ORDER BY
           CASE temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
           fragility DESC
         LIMIT 5`,
        [projectId]
      ),
      db.all<{ id: number; title: string }>(
        `SELECT id, title FROM decisions
         WHERE project_id = ? AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 5`,
        [projectId]
      ),
      db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM issues
         WHERE project_id = ? AND status = 'open'`,
        [projectId]
      ),
      db.all<{ goal: string }>(
        `SELECT DISTINCT goal FROM sessions
         WHERE project_id = ? AND goal IS NOT NULL
         ORDER BY started_at DESC
         LIMIT 5`,
        [projectId]
      ),
      db.all<{ title: string; content: string }>(
        `SELECT title, content FROM learnings
         WHERE project_id = ? AND foundational = 1 AND confidence >= 7
         ORDER BY times_applied DESC
         LIMIT 5`,
        [projectId]
      ),
    ]);

  const brief: ProjectBrief = {
    hotFiles,
    activeDecisions,
    openIssueCount: openIssueCount?.count ?? 0,
    recentGoals: recentSessions.map((s) => s.goal),
    foundationalLearnings: foundational,
  };

  // Output markdown to stdout
  const lines: string[] = [];

  if (hotFiles.length > 0) {
    lines.push(
      `Hot: ${hotFiles.map((f) => `${f.path}${f.fragility >= 7 ? " (FRAGILE)" : ""}`).join(", ")}`
    );
  }

  if (activeDecisions.length > 0) {
    lines.push(
      `Decisions: ${activeDecisions.map((d) => `D${d.id} ${d.title.substring(0, 50)}`).join(" | ")}`
    );
  }

  if (brief.openIssueCount > 0) {
    lines.push(`Issues: ${brief.openIssueCount} open`);
  }

  if (foundational.length > 0) {
    lines.push(
      `Key learnings: ${foundational.map((l) => l.title).join(", ")}`
    );
  }

  if (lines.length > 0) {
    console.log(lines.join("\n"));
  }

  return brief;
}

// ============================================================================
// Helpers
// ============================================================================

function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

async function countStaleFiles(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string
): Promise<number> {
  let count = 0;

  const files = await db.all<{
    path: string;
    content_hash: string | null;
  }>(
    `SELECT path, content_hash FROM files
     WHERE project_id = ? AND status = 'active' AND content_hash IS NOT NULL`,
    [projectId]
  );

  for (const file of files) {
    const fullPath = join(projectPath, file.path);
    if (!existsSync(fullPath)) {
      count++;
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const hash = computeContentHash(content);
      if (hash !== file.content_hash) {
        count++;
      }
    } catch {
      // Skip
    }
  }

  return count;
}
