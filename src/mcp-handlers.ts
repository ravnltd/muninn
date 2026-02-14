/**
 * Muninn MCP Handlers — In-Process
 *
 * Typed wrappers that call core functions directly,
 * avoiding CLI process spawning and redundant DB init.
 *
 * Each handler takes validated MCP input and returns a string result.
 */

import type { DatabaseAdapter } from "./database/adapter";

// ============================================================================
// Console Output Capture
// ============================================================================

/** Sentinel error thrown when a command calls process.exit() */
class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "ProcessExitError";
  }
}

/**
 * Capture console.log/console.error output from functions that write to console.
 * Also intercepts process.exit() calls to prevent killing the MCP server.
 * Safe because MCP processes tool calls sequentially.
 */
const CAPTURE_TIMEOUT_MS = 30_000;

export async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;

  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  process.exit = ((code?: number) => {
    throw new ProcessExitError(code ?? 0);
    // biome-ignore lint/suspicious/noExplicitAny: process.exit override must match signature
  }) as any;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("[TIMEOUT] Command exceeded 30s limit")),
        CAPTURE_TIMEOUT_MS
      );
      timer.unref();
    });

    await Promise.race([fn(), timeoutPromise]);
    return lines.join("\n");
  } catch (error) {
    if (error instanceof ProcessExitError) {
      return lines.join("\n");
    }
    if (error instanceof Error && error.message.includes("[TIMEOUT]")) {
      lines.push(error.message);
      return lines.join("\n");
    }
    throw error;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }
}

// ============================================================================
// Core Tool Handlers
// ============================================================================

export async function handleQuery(
  db: DatabaseAdapter,
  projectId: number,
  params: { query: string; smart?: boolean; vector?: boolean; fts?: boolean; cwd?: string }
): Promise<string> {
  const { handleQueryCommand } = await import("./commands/query");
  const args = [params.query];
  if (params.smart) args.push("--smart");
  if (params.vector) args.push("--vector");
  if (params.fts) args.push("--fts");
  return captureOutput(() => handleQueryCommand(db, projectId, args));
}

export async function handleCheck(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  params: { files: string[] }
): Promise<string> {
  const { checkFiles } = await import("./commands/intelligence");
  return captureOutput(() => {
    // checkFiles returns FileCheck[] but also writes to console
    return checkFiles(db, projectId, cwd, params.files).then(() => {});
  });
}

export async function handleFileAdd(
  db: DatabaseAdapter,
  projectId: number,
  params: { path: string; purpose: string; fragility: number; fragility_reason?: string; type?: string }
): Promise<string> {
  const { fileAdd } = await import("./commands/memory");
  const args = [params.path, "--purpose", params.purpose, "--fragility", String(params.fragility)];
  if (params.fragility_reason) args.push("--fragility-reason", params.fragility_reason);
  if (params.type) args.push("--type", params.type);
  return captureOutput(() => fileAdd(db, projectId, args));
}

export async function handleDecisionAdd(
  db: DatabaseAdapter,
  projectId: number,
  params: { title: string; decision: string; reasoning: string; affects?: string }
): Promise<string> {
  const { decisionAdd } = await import("./commands/memory");
  const args = ["--title", params.title, "--decision", params.decision, "--reasoning", params.reasoning];
  if (params.affects) args.push("--affects", params.affects);
  return captureOutput(() => decisionAdd(db, projectId, args));
}

export async function handleLearnAdd(
  db: DatabaseAdapter,
  projectId: number,
  params: {
    title: string;
    content: string;
    category?: string;
    context?: string;
    global?: boolean;
    files?: string;
    foundational?: boolean;
    reviewAfter?: number;
  }
): Promise<string> {
  const { learnAdd } = await import("./commands/memory");
  const args = ["--title", params.title, "--content", params.content];
  if (params.category) args.push("--category", params.category);
  if (params.context) args.push("--context", params.context);
  if (params.global) args.push("--global");
  if (params.files) args.push("--files", params.files);
  if (params.foundational) args.push("--foundational");
  if (params.reviewAfter) args.push("--review-after", String(params.reviewAfter));
  return captureOutput(() => learnAdd(db, projectId, args));
}

export async function handleIssueAdd(
  db: DatabaseAdapter,
  projectId: number,
  params: { title: string; description?: string; severity?: number; type?: string }
): Promise<string> {
  const { issueAdd } = await import("./commands/memory");
  const args = ["--title", params.title, "--severity", String(params.severity ?? 5)];
  if (params.description) args.push("--description", params.description);
  if (params.type) args.push("--type", params.type);
  return captureOutput(() => issueAdd(db, projectId, args));
}

export async function handleIssueResolve(
  db: DatabaseAdapter,
  params: { id: number; resolution: string }
): Promise<string> {
  const { issueResolve } = await import("./commands/memory");
  return captureOutput(() => issueResolve(db, params.id, params.resolution));
}

export async function handleSessionStart(
  db: DatabaseAdapter,
  projectId: number,
  params: { goal: string },
  _cwd: string
): Promise<string> {
  // Auto-end any active session first
  const lastSession = await db.get<{ id: number; ended_at: string | null }>(
    "SELECT id, ended_at FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
    [projectId]
  );

  if (lastSession && !lastSession.ended_at) {
    const { sessionEndEnhanced } = await import("./commands/session");
    try {
      await sessionEndEnhanced(db, projectId, lastSession.id, ["--outcome", "Replaced by new session"]);
    } catch {
      // Best effort - continue even if end fails
    }
  }

  const { sessionStart } = await import("./commands/session");
  return captureOutput(() => {
    return sessionStart(db, projectId, params.goal).then(() => {});
  });
}

export async function handleSessionEnd(
  db: DatabaseAdapter,
  projectId: number,
  params: { outcome?: string; next_steps?: string; success?: number }
): Promise<string> {
  // Find the active session
  const lastSession = await db.get<{ id: number; ended_at: string | null }>(
    "SELECT id, ended_at FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
    [projectId]
  );

  if (!lastSession || lastSession.ended_at) {
    return JSON.stringify({ error: "No active session" });
  }

  const { sessionEndEnhanced } = await import("./commands/session");
  const args: string[] = [];
  if (params.outcome) args.push("--outcome", params.outcome);
  if (params.next_steps) args.push("--next", params.next_steps);
  if (params.success !== undefined) args.push("--success", String(params.success));

  return captureOutput(() => {
    return sessionEndEnhanced(db, projectId, lastSession.id, args).then(() => {});
  });
}

export async function handlePredict(
  db: DatabaseAdapter,
  projectId: number,
  params: { task?: string; files?: string[]; advise?: boolean }
): Promise<string> {
  const { handlePredictCommand } = await import("./commands/predict");
  const args: string[] = [];
  if (params.task) args.push(params.task);
  if (params.files && params.files.length > 0) args.push("--files", ...params.files);
  if (params.advise) args.push("--advise");
  return captureOutput(() => handlePredictCommand(db, projectId, args));
}

export async function handleSuggest(
  db: DatabaseAdapter,
  projectId: number,
  params: { task: string; limit?: number; includeSymbols?: boolean }
): Promise<string> {
  const { handleSuggestCommand } = await import("./commands/suggest");
  const args = [params.task];
  if (params.limit) args.push("--limit", String(params.limit));
  if (params.includeSymbols) args.push("--symbols");
  return captureOutput(() => handleSuggestCommand(db, projectId, args));
}

export async function handleEnrich(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  params: { tool: string; input: string }
): Promise<string> {
  const { handleEnrichCommand } = await import("./commands/enrich");
  return captureOutput(() => handleEnrichCommand(db, projectId, cwd, [params.tool, params.input]));
}

export async function handleApprove(
  db: DatabaseAdapter,
  params: { operationId: string }
): Promise<string> {
  const { handleApproveCommand } = await import("./commands/enrich");
  return captureOutput(() => handleApproveCommand(db, [params.operationId]));
}

// ============================================================================
// Passthrough Command Router
// ============================================================================

/**
 * Route passthrough commands to their handler functions in-process.
 */
export async function handlePassthrough(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  subcommand: string,
  args: string[]
): Promise<string> {
  return captureOutput(async () => {
    switch (subcommand) {
      case "status": {
        const { showStatus } = await import("./commands/analysis");
        await showStatus(db, projectId);
        break;
      }
      case "fragile": {
        const { showFragile } = await import("./commands/analysis");
        await showFragile(db, projectId);
        break;
      }
      case "brief": {
        const { generateBrief } = await import("./commands/analysis");
        const brief = await generateBrief(db, projectId, cwd);
        console.error(brief);
        break;
      }
      case "resume": {
        const { generateResume } = await import("./commands/session");
        const resume = await generateResume(db, projectId);
        console.error(resume);
        break;
      }
      case "smart-status":
      case "ss": {
        const { getSmartStatus } = await import("./commands/intelligence");
        await getSmartStatus(db, projectId, cwd);
        break;
      }
      case "observe":
      case "obs": {
        const { handleObserveCommand } = await import("./commands/observe");
        await handleObserveCommand(db, projectId, args);
        break;
      }
      case "bookmark":
      case "bm": {
        const { handleBookmarkCommand } = await import("./commands/bookmark");
        await handleBookmarkCommand(db, projectId, args);
        break;
      }
      case "focus": {
        const { handleFocusCommand } = await import("./commands/focus");
        await handleFocusCommand(db, projectId, args);
        break;
      }
      case "outcome": {
        const { handleOutcomeCommand } = await import("./commands/outcomes");
        await handleOutcomeCommand(db, projectId, args);
        break;
      }
      case "insights": {
        const { handleInsightsCommand } = await import("./commands/insights");
        await handleInsightsCommand(db, projectId, args);
        break;
      }
      case "profile": {
        const { handleProfileCommand } = await import("./commands/profile");
        await handleProfileCommand(db, projectId, args);
        break;
      }
      case "workflow":
      case "wf": {
        const { handleWorkflowCommand } = await import("./commands/workflow");
        await handleWorkflowCommand(db, projectId, args);
        break;
      }
      case "foundational": {
        const { handleFoundationalCommand } = await import("./commands/outcomes");
        await handleFoundationalCommand(db, projectId, args);
        break;
      }
      case "correlations": {
        const { handleCorrelationCommand } = await import("./commands/session");
        await handleCorrelationCommand(db, projectId, args);
        break;
      }
      case "temporal": {
        const { handleTemporalCommand } = await import("./commands/temporal");
        await handleTemporalCommand(db, projectId, args);
        break;
      }
      case "drift": {
        const { detectDrift } = await import("./commands/git");
        await detectDrift(db, projectId, cwd);
        break;
      }
      case "conflicts": {
        const { checkConflicts } = await import("./commands/intelligence");
        if (args.length === 0) {
          console.error("Usage: muninn conflicts <file1> [file2] ...");
        } else {
          await checkConflicts(db, projectId, cwd, args);
        }
        break;
      }
      case "git-info": {
        const { getGitInfo } = await import("./commands/git");
        const { outputSuccess } = await import("./utils/format");
        outputSuccess(getGitInfo(cwd));
        break;
      }
      case "sync-hashes": {
        const { syncFileHashes } = await import("./commands/git");
        await syncFileHashes(db, projectId, cwd);
        break;
      }
      case "deps": {
        const { showDependencies, refreshDependencies, generateDependencyGraph, findCircularDependencies } =
          await import("./commands/deps");
        if (args.includes("--refresh")) {
          await refreshDependencies(db, projectId, cwd);
        } else if (args.includes("--graph")) {
          const focusFile = args.find((a) => !a.startsWith("--"));
          await generateDependencyGraph(db, projectId, cwd, focusFile);
        } else if (args.includes("--cycles")) {
          findCircularDependencies(cwd);
        } else if (args.length > 0 && !args[0].startsWith("--")) {
          await showDependencies(db, projectId, cwd, args[0]);
        } else {
          console.error("Usage: muninn deps <file> | --refresh | --graph [file] | --cycles");
        }
        break;
      }
      case "blast": {
        const { computeBlastRadius, showBlastRadius, showHighImpactFiles } = await import("./commands/blast");
        if (args.includes("--refresh")) {
          await computeBlastRadius(db, projectId, cwd);
        } else if (args.includes("--high")) {
          await showHighImpactFiles(db, projectId);
        } else if (args.length > 0 && !args[0].startsWith("--")) {
          await showBlastRadius(db, projectId, cwd, args[0]);
        } else {
          console.error("Usage: muninn blast <file> | --refresh | --high");
        }
        break;
      }
      case "reindex": {
        const { reindexProject } = await import("./code-intel/ast-parser");
        const { buildAndPersistCallGraph } = await import("./code-intel/call-graph");
        const { buildAndPersistTestMap } = await import("./code-intel/test-mapper");
        console.error("Reindexing project symbols...");
        const symbolResult = await reindexProject(db, projectId, cwd);
        console.error(`Symbols: ${symbolResult.parsed} parsed, ${symbolResult.symbols} symbols, ${symbolResult.skipped} skipped`);
        if (symbolResult.parsed > 0) {
          // Build call graph from all parseable files
          const { readdirSync, statSync: statSyncFn } = await import("node:fs");
          const { relative: relativeFn, extname: extnameFn, join: joinFn } = await import("node:path");
          const codeExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
          const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
          const allFiles: string[] = [];
          const walkDir = (dir: string, depth = 0): void => {
            if (depth > 15 || allFiles.length >= 2000) return;
            try {
              for (const entry of readdirSync(dir)) {
                if (allFiles.length >= 2000) break;
                if (entry.startsWith(".") || ignoreDirs.has(entry)) continue;
                const full = joinFn(dir, entry);
                const st = statSyncFn(full);
                if (st.isDirectory()) walkDir(full, depth + 1);
                else if (st.isFile() && codeExts.has(extnameFn(entry))) {
                  allFiles.push(relativeFn(cwd, full));
                }
              }
            } catch { /* skip */ }
          };
          walkDir(cwd);
          console.error("Building call graph...");
          const cgResult = await buildAndPersistCallGraph(db, projectId, cwd, allFiles);
          console.error(`Call graph: ${cgResult.edges} edges from ${cgResult.files} files`);
          console.error("Building test-source map...");
          const tmResult = await buildAndPersistTestMap(db, projectId, cwd);
          console.error(`Test map: ${tmResult.mappings} mappings from ${tmResult.tests} test files`);
        }
        break;
      }
      case "team": {
        const subAction = args[0];
        if (subAction === "learnings") {
          const { getTeamLearnings } = await import("./team/knowledge-aggregator");
          const domain = args[1];
          const learnings = await getTeamLearnings(db, projectId, domain);
          if (learnings.length === 0) {
            console.error("No team learnings found.");
          } else {
            for (const l of learnings) {
              console.error(`[${l.category}] ${l.title} (confidence: ${l.confidence})`);
              console.error(`  ${l.content.slice(0, 150)}`);
            }
          }
        } else if (subAction === "aggregate") {
          const { aggregateLearnings } = await import("./team/knowledge-aggregator");
          const result = await aggregateLearnings(db, projectId);
          console.error(`Promoted ${result.promoted}, skipped ${result.skipped} (already existed)`);
        } else if (subAction === "reviews") {
          const { getReviewPatterns } = await import("./team/pr-reviews");
          const patterns = await getReviewPatterns(db, projectId);
          if (patterns.length === 0) {
            console.error("No review patterns found.");
          } else {
            for (const p of patterns) {
              console.error(`[${p.category}] ${p.pattern} (${p.occurrences}x)${p.promoted ? " [promoted]" : ""}`);
            }
          }
        } else if (subAction === "cross-project") {
          const { detectAllPatterns } = await import("./team/cross-project");
          const patterns = await detectAllPatterns(db, projectId);
          if (patterns.length === 0) {
            console.error("No cross-project patterns detected.");
          } else {
            for (const p of patterns) {
              console.error(`[${p.type}] ${p.title}`);
              console.error(`  ${p.description.slice(0, 150)}`);
            }
          }
        } else {
          console.error("Usage: muninn team learnings [domain] | aggregate | reviews | cross-project");
        }
        break;
      }
      case "ownership": {
        if (args.includes("--refresh")) {
          const { refreshOwnership } = await import("./team/ownership");
          const result = await refreshOwnership(db, projectId);
          console.error(`Updated ownership for ${result.updated} files`);
        } else if (args.length > 0 && !args[0].startsWith("--")) {
          const { getOwnerContext } = await import("./team/ownership");
          const ctx = await getOwnerContext(db, projectId, args[0]);
          if (!ctx) {
            console.error(`No ownership data for ${args[0]}`);
          } else {
            console.error(`Owner: ${ctx.owner}`);
            if (ctx.decisions.length > 0) {
              console.error("Related decisions:");
              for (const d of ctx.decisions) console.error(`  - ${d}`);
            }
            if (ctx.learnings.length > 0) {
              console.error("Related learnings:");
              for (const l of ctx.learnings) console.error(`  - ${l}`);
            }
          }
        } else {
          console.error("Usage: muninn ownership <file> | --refresh");
        }
        break;
      }
      case "onboarding": {
        const { generateOnboardingContext, formatOnboardingContext } = await import("./team/onboarding");
        const forceRefresh = args.includes("--refresh");
        const context = await generateOnboardingContext(db, projectId, forceRefresh);
        console.error(formatOnboardingContext(context));
        break;
      }
      case "debt": {
        const { handleDebtCommand } = await import("./commands/global");
        handleDebtCommand(args);
        break;
      }
      case "pattern": {
        const { handlePatternCommand } = await import("./commands/global");
        await handlePatternCommand(db, args);
        break;
      }
      case "stack": {
        const { handleStackCommand } = await import("./commands/global");
        handleStackCommand();
        break;
      }
      case "db": {
        const { handleDatabaseCommand } = await import("./commands/database");
        handleDatabaseCommand(db, args);
        break;
      }
      default:
        throw new Error(`Unknown passthrough command: ${subcommand}`);
    }
  });
}
