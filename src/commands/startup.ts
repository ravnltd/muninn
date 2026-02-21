/**
 * Fast Startup Command
 * Combines resume + smart-status + session-start into a single process.
 * All read queries run in parallel via Promise.all, eliminating
 * multiple CLI process spawns and DB connection setups.
 *
 * Expected improvement: 5-8s → ~1-1.5s
 */

import type { DatabaseAdapter } from "../database/adapter";
import { execSync, execFile as execFileCb } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);
import { isNativeFormat } from "../config/index.js";
import { getTimeAgo } from "../utils/format";
import {
  formatSession,
  formatDecision,
  formatInsight,
} from "../output/formatter.js";
import { decayTemperatures, getRecentObservations } from "./temperature";
import {
  getDecisionsDue,
  incrementSessionsSince,
  getFoundationalLearningsDue,
  incrementFoundationalSessionsSince,
} from "./outcomes";
import { listInsights, generateInsights } from "./insights";
import { assignSessionNumber } from "./temporal";

// ============================================================================
// Types
// ============================================================================

interface UpdateInfo {
  behind: boolean;
  count: number;
  updateCmd: string;
  warning?: string;
}

interface StartupResult {
  resume: string;
  smartStatus: {
    health: string;
    actions: Array<{ priority: number; action: string; reason: string }>;
    warnings: string[];
  };
  sessionId: number;
  updateAvailable?: { count: number; command: string };
}

// ============================================================================
// Fast Startup
// ============================================================================

export async function fastStartup(
  db: DatabaseAdapter,
  projectId: number,
  projectPath: string,
  goal: string
): Promise<StartupResult> {
  // ── Phase 1: Parallel reads ──────────────────────────────────────────
  // Fire all independent read queries at once
  const [
    lastSession,
    decisionsDue,
    newInsights,
    foundationalDue,
    fragileHot,
    criticalIssues,
    ongoingSession,
    fragileFiles,
    lastEndedSession,
    techDebt,
    openIssueCount,
    highFragilityCount,
    recentObs,
    staleFileCount,
    gitChangedFiles,
    updateInfo,
  ] = await Promise.all([
    // Resume data
    db.get<Record<string, unknown>>(
      `SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1`,
      [projectId]
    ),
    // Decisions due for review
    safeQuery(() => getDecisionsDue(db, projectId)),
    // New insights
    safeQuery(() => listInsights(db, projectId, { status: "new" })),
    // Foundational learnings due
    safeQuery(() => getFoundationalLearningsDue(db, projectId)),
    // Fragile hot files
    safeQuery(() =>
      db.all<{ path: string; fragility: number }>(
        `SELECT path, fragility FROM files
         WHERE project_id = ? AND temperature = 'hot' AND fragility >= 7
         ORDER BY fragility DESC LIMIT 3`,
        [projectId]
      )
    ),
    // Critical issues (severity >= 8)
    db.all<{ id: number; title: string; severity: number }>(
      `SELECT id, title, severity FROM issues
       WHERE project_id = ? AND status = 'open' AND severity >= 8
       ORDER BY severity DESC`,
      [projectId]
    ),
    // Ongoing session
    db.get<{ id: number; goal: string; started_at: string }>(
      `SELECT id, goal, started_at FROM sessions
       WHERE project_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [projectId]
    ),
    // All fragile files (for git cross-ref)
    db.all<{ path: string; fragility: number }>(
      `SELECT path, fragility FROM files
       WHERE project_id = ? AND fragility >= 7`,
      [projectId]
    ),
    // Last ended session (for next_steps)
    db.get<{ next_steps: string | null }>(
      `SELECT next_steps FROM sessions
       WHERE project_id = ? AND ended_at IS NOT NULL
       ORDER BY ended_at DESC LIMIT 1`,
      [projectId]
    ),
    // Tech debt
    db.all<{ id: number; title: string; severity: number }>(
      `SELECT id, title, severity FROM issues
       WHERE project_id = ? AND type = 'tech-debt' AND status = 'open'
       ORDER BY severity DESC LIMIT 3`,
      [projectId]
    ),
    // Open issue count (for health)
    db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM issues
       WHERE project_id = ? AND status = 'open' AND severity >= 5`,
      [projectId]
    ),
    // High fragility count (for health)
    db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM files
       WHERE project_id = ? AND fragility >= 8`,
      [projectId]
    ),
    // Recent observations
    safeQuery(() => getRecentObservations(db, projectId)),
    // Lightweight stale file count (DB-only, no disk I/O)
    safeQuery(() =>
      db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM files
         WHERE project_id = ? AND status = 'active' AND content_hash IS NOT NULL`,
        [projectId]
      )
    ),
    // Git changed files (with timeout)
    safeGitDiff(projectPath),
    // Update check (cached, fail-open)
    checkForUpdates(),
  ]);

  // ── Phase 2: Build resume markdown ───────────────────────────────────
  const resume = buildResume({
    lastSession: lastSession ?? undefined,
    decisionsDue,
    newInsights,
    foundationalDue,
    fragileHot,
    recentObs,
  });

  // ── Phase 3: Build smart status (no findStaleFiles) ──────────────────
  const smartStatus = buildSmartStatus({
    criticalIssues,
    ongoingSession: ongoingSession ?? undefined,
    fragileFiles,
    gitChangedFiles,
    lastEndedSession: lastEndedSession ?? undefined,
    techDebt,
    openIssueCount: openIssueCount?.count ?? 0,
    highFragilityCount: highFragilityCount?.count ?? 0,
    staleFileCount: staleFileCount?.count ?? 0,
  });

  // ── Phase 4: Start session (sequential writes) ───────────────────────
  // Decay temperatures first
  await decayTemperatures(db, projectId);

  // Insert session
  const insertResult = await db.run(
    `INSERT INTO sessions (project_id, goal) VALUES (?, ?)`,
    [projectId, goal]
  );
  const sessionId = Number(insertResult.lastInsertRowid);

  // Session bookkeeping (sequential - depends on sessionId)
  await assignSessionNumber(db, projectId, sessionId);
  await incrementSessionsSince(db, projectId);
  await incrementFoundationalSessionsSince(db, projectId);

  // Fire-and-forget insight generation (don't block startup)
  generateInsightsIfDue(db, projectId).catch(() => {});

  // Surface update check warnings into smart status
  if (updateInfo?.warning) {
    smartStatus.warnings.push(updateInfo.warning);
  }

  const result: StartupResult = { resume, smartStatus, sessionId };
  if (updateInfo?.behind && updateInfo.count > 0) {
    result.updateAvailable = {
      count: updateInfo.count,
      command: updateInfo.updateCmd,
    };
  }
  return result;
}

// ============================================================================
// Resume Builder
// ============================================================================

interface ResumeData {
  lastSession: Record<string, unknown> | undefined;
  decisionsDue: Array<{ id: number; title: string; sessions_since: number }>;
  newInsights: Array<{ id: number; type: string; title: string; content: string }>;
  foundationalDue: Array<{ id: number; title: string }>;
  fragileHot: Array<{ path: string; fragility: number }>;
  recentObs: Array<{ type: string; content: string; frequency: number }>;
}

function buildResume(data: ResumeData): string {
  const native = isNativeFormat();
  let md = "";

  // Required actions
  const hasRequired =
    data.decisionsDue.length > 0 ||
    data.newInsights.length > 0 ||
    data.foundationalDue.length > 0;

  if (hasRequired) {
    md += `## Required Actions\n`;

    if (data.decisionsDue.length > 0) {
      md += `- ${data.decisionsDue.length} decision(s) due for review`;
      if (native && data.decisionsDue.length <= 3) {
        md += `: ${data.decisionsDue.map((d) => formatDecision({ id: d.id, title: d.title, sessionsSince: d.sessions_since })).join(", ")}`;
      }
      md += "\n";
    }

    if (data.newInsights.length > 0) {
      md += `- ${data.newInsights.length} new insight(s) pending`;
      if (native && data.newInsights.length <= 3) {
        md += `: ${data.newInsights.map((i) => formatInsight({ id: i.id, type: i.type, title: i.title, content: i.content })).join(", ")}`;
      }
      md += "\n";
    }

    if (data.foundationalDue.length > 0) {
      md += `- ${data.foundationalDue.length} foundational learning(s) due for review\n`;
    }

    md += "\n";
  }

  // Fragile hot file warnings
  if (data.fragileHot.length > 0) {
    md += `## Warnings\n`;
    md += `- Fragile hot files: ${data.fragileHot.map((f) => `${f.path} (frag:${f.fragility})`).join(", ")}\n\n`;
  }

  // Session resume point
  if (!data.lastSession) {
    md += `No previous sessions found.\n`;
    return md;
  }

  const timeAgo = getTimeAgo(
    (data.lastSession.ended_at || data.lastSession.started_at) as string
  );
  const isOngoing = !data.lastSession.ended_at;

  md += `# Resume Point\n\n`;
  if (native) {
    md += formatSession({
      id: data.lastSession.id as number,
      goal: data.lastSession.goal as string | null,
      outcome: data.lastSession.outcome as string | null,
      nextSteps: data.lastSession.next_steps as string | null,
      timeAgo,
      isOngoing,
    });
    md += "\n\n";
  } else {
    md += `**Session #${data.lastSession.id}** ${timeAgo}${isOngoing ? " (ongoing)" : ""}\n`;
    md += `Goal: ${data.lastSession.goal || "Not specified"}\n`;
    if (data.lastSession.outcome) md += `Outcome: ${data.lastSession.outcome}\n`;
    md += "\n";
  }

  // Files modified (compact, max 5)
  if (data.lastSession.files_touched) {
    try {
      const files = JSON.parse(data.lastSession.files_touched as string) as string[];
      if (files.length > 0) {
        md += `## Files Modified\n`;
        for (const f of files.slice(0, 5)) md += `- ${f}\n`;
        if (files.length > 5) md += `- ...and ${files.length - 5} more\n`;
        md += "\n";
      }
    } catch { /* skip */ }
  }

  // Recent observations (compact, max 3)
  if (data.recentObs.length > 0) {
    md += `## Recent Observations\n`;
    for (const obs of data.recentObs.slice(0, 3)) {
      md += `- [${obs.type}] ${obs.content.slice(0, 60)}\n`;
    }
    md += "\n";
  }

  // Next steps
  if (data.lastSession.next_steps) {
    md += `## Next Steps\n`;
    const nextSteps = data.lastSession.next_steps as string;
    const steps = nextSteps
      .split(/[\n\u2022-]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const step of steps.slice(0, 3)) md += `- [ ] ${step}\n`;
    md += "\n";
  }

  // Footer
  if (isOngoing) {
    md += `---\nSession still in progress. Use \`muninn session end ${data.lastSession.id}\` to close it.\n`;
  } else {
    const goalPreview = ((data.lastSession.goal as string) || "previous work").substring(0, 40);
    md += `---\nContinue with: \`muninn session start "Continue: ${goalPreview}"\`\n`;
  }

  return md;
}

// ============================================================================
// Smart Status Builder (no findStaleFiles - DB-only)
// ============================================================================

interface SmartStatusData {
  criticalIssues: Array<{ id: number; title: string; severity: number }>;
  ongoingSession: { id: number; goal: string; started_at: string } | undefined;
  fragileFiles: Array<{ path: string; fragility: number }>;
  gitChangedFiles: string[];
  lastEndedSession: { next_steps: string | null } | undefined;
  techDebt: Array<{ id: number; title: string; severity: number }>;
  openIssueCount: number;
  highFragilityCount: number;
  staleFileCount: number;
}

function buildSmartStatus(data: SmartStatusData): StartupResult["smartStatus"] {
  const actions: Array<{ priority: number; action: string; reason: string }> = [];
  const warnings: string[] = [];

  // Critical issues
  for (const issue of data.criticalIssues) {
    actions.push({
      priority: 1,
      action: `Fix issue #${issue.id}: ${issue.title}`,
      reason: `Critical severity (${issue.severity}/10)`,
    });
  }

  // Stale files (lightweight - just report count, no disk I/O)
  if (data.staleFileCount > 0) {
    actions.push({
      priority: 2,
      action: `Update knowledge for ${data.staleFileCount} stale file(s)`,
      reason: "Files have changed since last analysis",
    });
    warnings.push(`${data.staleFileCount} file(s) have outdated knowledge`);
  }

  // Ongoing session
  if (data.ongoingSession) {
    warnings.push(
      `Session #${data.ongoingSession.id} still in progress: "${data.ongoingSession.goal}"`
    );
  }

  // Fragile files recently modified (cross-ref git diff with fragile list)
  const fragileChanged = data.fragileFiles.filter((f) =>
    data.gitChangedFiles.includes(f.path)
  );
  if (fragileChanged.length > 0) {
    warnings.push(`${fragileChanged.length} fragile file(s) recently modified`);
    actions.push({
      priority: 2,
      action: "Review recent changes to fragile files",
      reason: `${fragileChanged.map((f) => f.path).join(", ")} modified`,
    });
  }

  // Pending next steps from last session
  if (data.lastEndedSession?.next_steps) {
    actions.push({
      priority: 3,
      action: data.lastEndedSession.next_steps.substring(0, 100),
      reason: "Pending from last session",
    });
  }

  // Tech debt
  if (data.techDebt.length > 0) {
    actions.push({
      priority: 4,
      action: `Address tech debt: ${data.techDebt.map((d) => d.title).join(", ")}`,
      reason: `${data.techDebt.length} item(s) tracked`,
    });
  }

  // Calculate health
  const health = calculateHealth(
    data.criticalIssues.length,
    data.openIssueCount,
    data.highFragilityCount,
    data.staleFileCount
  );

  return {
    health,
    actions: actions.sort((a, b) => a.priority - b.priority),
    warnings,
  };
}

// ============================================================================
// Update Check
// ============================================================================

const UPDATE_CACHE_PATH = "/tmp/muninn-update-check.json";
const UPDATE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
const UPDATE_CMD = "cd ~/.local/share/muninn && git pull && bun install && ./install.sh";

interface UpdateCache {
  timestamp: number;
  behind: boolean;
  count: number;
}

async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    // Check cache first
    const cached = readUpdateCache();
    if (cached) {
      return {
        behind: cached.behind,
        count: cached.count,
        updateCmd: UPDATE_CMD,
      };
    }

    // Resolve muninn source directory
    const muninnDir = getMuninnSourceDir();
    if (!muninnDir) return null;

    const localHead = await getLocalHead(muninnDir);
    if (!localHead) return null;

    // Try SSH first, fall back to HTTPS API
    const remoteHead = await getRemoteHeadSsh(muninnDir)
      ?? await getRemoteHeadHttps(muninnDir);

    if (!remoteHead) {
      return {
        behind: false,
        count: 0,
        updateCmd: UPDATE_CMD,
        warning: "Update check failed: could not reach remote (SSH key passphrase? No network?)",
      };
    }

    if (remoteHead === localHead) {
      writeUpdateCache(false, 0);
      return null;
    }

    // Try to get exact commit count via fetch, fall back to "at least 1"
    const count = await fetchAndCountBehind(muninnDir) ?? 1;
    writeUpdateCache(true, count);
    return { behind: true, count, updateCmd: UPDATE_CMD };
  } catch {
    return {
      behind: false,
      count: 0,
      updateCmd: UPDATE_CMD,
      warning: "Update check failed unexpectedly",
    };
  }
}

/** Get local HEAD sha */
async function getLocalHead(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", timeout: 5000 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Try git ls-remote via SSH (fast, but fails with passphrase-protected keys) */
async function getRemoteHeadSsh(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git", ["ls-remote", "origin", "HEAD"],
      {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3",
        },
      }
    );
    return stdout.split(/\s/)[0]?.trim() || null;
  } catch {
    return null;
  }
}

/** Fallback: use GitHub HTTPS API to get HEAD sha (no SSH required) */
async function getRemoteHeadHttps(cwd: string): Promise<string | null> {
  try {
    // Parse owner/repo from the git remote URL
    const { stdout: remoteUrl } = await execFileAsync(
      "git", ["remote", "get-url", "origin"], { cwd, encoding: "utf-8", timeout: 3000 }
    );
    const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!match) return null;

    const [, owner, repo] = match;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/HEAD`;

    const response = await fetch(apiUrl, {
      headers: { Accept: "application/vnd.github.sha", "User-Agent": "muninn-update-check" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;
    const sha = (await response.text()).trim();
    return sha.length === 40 ? sha : null;
  } catch {
    return null;
  }
}

/** Fetch and count commits behind. Returns null if fetch fails. */
async function fetchAndCountBehind(cwd: string): Promise<number | null> {
  try {
    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3",
    };
    const gitOpts = {
      cwd,
      encoding: "utf-8" as const,
      timeout: 10000,
      env: gitEnv,
    };

    await execFileAsync("git", ["fetch", "origin", "--quiet"], gitOpts);

    const { stdout } = await execFileAsync(
      "git", ["rev-list", "HEAD..origin/HEAD", "--count"],
      { cwd, encoding: "utf-8", timeout: 5000 }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return null;
  }
}

function readUpdateCache(): UpdateCache | null {
  try {
    const raw = readFileSync(UPDATE_CACHE_PATH, "utf-8");
    const data = JSON.parse(raw) as UpdateCache;
    if (Date.now() - data.timestamp < UPDATE_CACHE_MAX_AGE_MS) {
      return data;
    }
  } catch {
    // No cache or invalid — will re-check
  }
  return null;
}

function writeUpdateCache(behind: boolean, count: number): void {
  try {
    writeFileSync(
      UPDATE_CACHE_PATH,
      JSON.stringify({ timestamp: Date.now(), behind, count }),
    );
  } catch {
    // Non-critical
  }
}

function getMuninnSourceDir(): string | null {
  try {
    // import.meta.dir points to the compiled/source dir
    // Walk up from src/commands/ to the repo root
    const dir = import.meta.dir;
    const parts = dir.split("/");
    const srcIdx = parts.lastIndexOf("src");
    if (srcIdx > 0) {
      return parts.slice(0, srcIdx).join("/");
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function calculateHealth(
  criticalCount: number,
  openIssueCount: number,
  highFragilityCount: number,
  staleCount: number
): string {
  if (criticalCount > 0) return "critical";
  if (openIssueCount > 5 || staleCount > 10 || highFragilityCount > 5) return "attention";
  return "good";
}

/** Wrap a query that might fail due to missing columns/tables */
async function safeQuery<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return [] as unknown as T;
  }
}

/** Get git changed files with timeout, non-blocking on failure */
function safeGitDiff(projectPath: string): Promise<string[]> {
  try {
    const output = execSync("git diff --name-only HEAD~5 2>/dev/null || echo ''", {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 5000,
    });
    return Promise.resolve(
      output.trim().split("\n").filter(Boolean)
    );
  } catch {
    return Promise.resolve([]);
  }
}

async function generateInsightsIfDue(
  db: DatabaseAdapter,
  projectId: number
): Promise<void> {
  try {
    const last = await db.get<{ generated_at: string | null }>(
      `SELECT MAX(generated_at) as generated_at FROM insights WHERE project_id = ?`,
      [projectId]
    );

    if (!last?.generated_at) {
      await generateInsights(db, projectId);
      return;
    }

    const since = last.generated_at;

    const sessions = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM sessions WHERE project_id = ? AND ended_at > ?`,
      [projectId, since]
    );
    if ((sessions?.count ?? 0) >= 3) {
      await generateInsights(db, projectId);
      return;
    }

    const correlations = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM file_correlations WHERE project_id = ? AND last_cochange > ?`,
      [projectId, since]
    );
    if ((correlations?.count ?? 0) >= 5) {
      await generateInsights(db, projectId);
      return;
    }

    const decisions = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM decisions WHERE project_id = ? AND decided_at > ?`,
      [projectId, since]
    );
    if ((decisions?.count ?? 0) >= 2) {
      await generateInsights(db, projectId);
    }
  } catch {
    // Best-effort
  }
}
