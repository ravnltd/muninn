#!/usr/bin/env bun
/**
 * Muninn — Elite Mode
 * Main CLI entry point
 */

import type { DatabaseAdapter } from "./database/adapter";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateBrief, runAnalysis, showFragile, showStatus } from "./commands/analysis";
import { computeBlastRadius, showBlastRadius, showHighImpactFiles } from "./commands/blast";
import { handleBookmarkCommand } from "./commands/bookmark";
import { handleChunkCommand } from "./commands/chunk";
import { handleConsolidationCommand } from "./commands/consolidation";
import { handleConversationsCommand } from "./commands/conversations";
import { handleDatabaseCommand } from "./commands/database";
import {
  findCircularDependencies,
  generateDependencyGraph,
  refreshDependencies,
  showDependencies,
} from "./commands/deps";
import { handleEmbedCommand } from "./commands/embed";
import { handleEnrichCommand, handleApproveCommand, handleEnrichmentStatusCommand } from "./commands/enrich";
import { handleFocusCommand } from "./commands/focus";
import { detectDrift, getGitInfo, syncFileHashes } from "./commands/git";
import { handleDebtCommand, handlePatternCommand, handleStackCommand } from "./commands/global";
import { hookBrain, hookCheck, hookInit, hookPostEdit } from "./commands/hooks";
import { handleInfraCommand } from "./commands/infra";
import { handleNativeCommand } from "./commands/native";
import { handleNetworkCommand } from "./commands/network";
import { generateInsights, handleInsightsCommand } from "./commands/insights";
import { analyzeImpact, checkConflicts, checkFiles, getSmartStatus } from "./commands/intelligence";
import {
  decisionAdd,
  decisionList,
  fileAdd,
  fileCleanup,
  fileGet,
  fileList,
  issueAdd,
  issueList,
  issueResolve,
  learnAdd,
  learnList,
} from "./commands/memory";
import { handleObserveCommand } from "./commands/observe";
import { handleFoundationalCommand, handleOutcomeCommand, incrementSessionsSince } from "./commands/outcomes";
import {
  handleConflictsCommand,
  handleHistoryCommand,
  handleReinforceCommand,
} from "./commands/continuous-learning";
import { handlePromotionCommand } from "./commands/promotion";
import { handlePredictCommand } from "./commands/predict";
import { handleProfileCommand } from "./commands/profile";
import { handleQueryCommand } from "./commands/query";
import { handleQuestionsCommand } from "./commands/questions";
import { handleRelationshipCommand } from "./commands/relationships";
import {
  generateResume,
  handleCorrelationCommand,
  sessionCount,
  sessionEndEnhanced,
  sessionLast,
  sessionList,
  sessionStart,
} from "./commands/session";
import { handleShipCommand } from "./commands/ship";
import { fastStartup } from "./commands/startup";
import { handleSuggestCommand } from "./commands/suggest";
import { assignSessionNumber, handleTemporalCommand, updateFileVelocity } from "./commands/temporal";
import { handleWorkflowCommand } from "./commands/workflow";
import {
  closeAll,
  ensureProject,
  getGlobalDb,
  getProjectDb,
  getProjectDbPath,
  initProjectDb,
  LOCAL_DB_DIR,
  LOCAL_DB_NAME,
} from "./database/connection";
import { HELP_TEXT } from "./help";
import { CLAUDE_MD_TEMPLATE, getMuninnSection, MUNINN_SECTION_END, MUNINN_SECTION_START } from "./templates/claude-md";
import { outputJson, outputSuccess } from "./utils/format";
import { flushFileUpdates } from "./ingestion/auto-file-update";
import { onShutdown, shutdown } from "./utils/shutdown";

// ============================================================================
// Main CLI Router
// ============================================================================

// Global stdin capture for commands that need it
let capturedStdin: string | null = null;

export function getCapturedStdin(): string | null {
  return capturedStdin;
}

async function main(): Promise<void> {
  // Capture stdin early before anything else can consume it
  if (!process.stdin.isTTY) {
    try {
      capturedStdin = await Bun.stdin.text();
    } catch {
      capturedStdin = null;
    }
  }

  const args = process.argv.slice(2);
  const command = args[0];
  const subArgs = args.slice(1);

  // Handle help
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP_TEXT);
    return;
  }

  // Handle init (creates project DB and CLAUDE.md)
  if (command === "init") {
    const db = await initProjectDb(process.cwd());
    const projectId = await ensureProject(db);

    // Install or update CLAUDE.md
    const claudeMdPath = join(process.cwd(), "CLAUDE.md");
    let claudeMdAction: "created" | "updated" | "unchanged" = "unchanged";

    if (!existsSync(claudeMdPath)) {
      // No CLAUDE.md exists - create from template
      writeFileSync(claudeMdPath, CLAUDE_MD_TEMPLATE);
      claudeMdAction = "created";
      console.error(`📄 Created CLAUDE.md with muninn instructions`);
    } else {
      // CLAUDE.md exists - check if it has muninn section
      const existing = readFileSync(claudeMdPath, "utf-8");
      if (!existing.includes(MUNINN_SECTION_START)) {
        // Append muninn section
        const updated = `${existing.trimEnd()}\n${getMuninnSection()}`;
        writeFileSync(claudeMdPath, updated);
        claudeMdAction = "updated";
        console.error(`📄 Added muninn section to existing CLAUDE.md`);
      } else {
        // Already has muninn section - update it
        const before = existing.split(MUNINN_SECTION_START)[0];
        const after = existing.split(MUNINN_SECTION_END)[1] || "";
        const updated = `${before.trimEnd()}\n${getMuninnSection()}${after.trimStart()}`;
        if (updated !== existing) {
          writeFileSync(claudeMdPath, updated);
          claudeMdAction = "updated";
          console.error(`📄 Updated muninn section in CLAUDE.md`);
        }
      }
    }

    console.error(`✅ Muninn initialized for ${process.cwd()}`);
    outputSuccess({
      projectId,
      dbPath: join(process.cwd(), LOCAL_DB_DIR, LOCAL_DB_NAME),
      claudeMd: claudeMdAction,
    });
    closeAll();
    return;
  }

  // Handle infrastructure commands (uses global DB only)
  if (command === "infra") {
    const globalDb = await getGlobalDb();
    try {
      await handleInfraCommand(globalDb, subArgs);
    } finally {
      closeAll();
    }
    return;
  }

  // Handle network commands
  if (command === "network") {
    const db = await getProjectDb();
    try {
      await handleNetworkCommand(db, subArgs);
    } finally {
      closeAll();
    }
    return;
  }

  // Handle pattern commands (uses global DB only)
  if (command === "pattern") {
    await handlePatternCommand(await getGlobalDb(), subArgs);
    return;
  }

  // Handle debt commands (uses global DB)
  if (command === "debt") {
    handleDebtCommand(subArgs);
    return;
  }

  // Handle stack command
  if (command === "stack") {
    handleStackCommand();
    return;
  }

  // All other commands need project DB
  let db: DatabaseAdapter;
  const dbPath = getProjectDbPath();

  // Auto-init if no DB exists
  if (!existsSync(dbPath) && dbPath.includes(LOCAL_DB_DIR)) {
    console.error("📁 No context database found. Initializing...\n");
    db = await initProjectDb(process.cwd());
  } else if (command === "analyze" && !existsSync(join(process.cwd(), LOCAL_DB_DIR, LOCAL_DB_NAME))) {
    // Allow analyze to init if needed
    db = await initProjectDb(process.cwd());
  } else {
    db = await getProjectDb();
  }

  const projectId = await ensureProject(db);

  try {
    switch (command) {
      case "query":
      case "q":
        await handleQueryCommand(db, projectId, subArgs);
        break;

      case "embed":
        await handleEmbedCommand(db, projectId, subArgs);
        break;

      case "native":
        await handleNativeCommand(db, projectId, subArgs);
        break;

      case "chunk":
        await handleChunkCommand(db, projectId, process.cwd(), subArgs);
        break;

      case "file":
      case "f": {
        const fileCmd = subArgs[0];
        switch (fileCmd) {
          case "add":
            await fileAdd(db, projectId, subArgs.slice(1));
            break;
          case "get":
            await fileGet(db, projectId, subArgs[1]);
            break;
          case "list":
            await fileList(db, projectId, subArgs[1]);
            break;
          case "cleanup": {
            const dryRun = subArgs.includes("--dry-run");
            await fileCleanup(db, projectId, dryRun);
            break;
          }
          default:
            console.error("Usage: muninn file <add|get|list|cleanup> [args]");
        }
        break;
      }

      case "decision":
      case "d": {
        const decCmd = subArgs[0];
        switch (decCmd) {
          case "add":
            await decisionAdd(db, projectId, subArgs.slice(1));
            break;
          case "list":
            await decisionList(db, projectId);
            break;
          default:
            console.error("Usage: muninn decision <add|list> [args]");
        }
        break;
      }

      case "issue":
      case "i": {
        const issueCmd = subArgs[0];
        switch (issueCmd) {
          case "add":
            await issueAdd(db, projectId, subArgs.slice(1));
            break;
          case "resolve": {
            const issueId = parseInt(subArgs[1], 10);
            if (Number.isNaN(issueId)) {
              console.error("Error: Invalid issue ID");
              break;
            }
            await issueResolve(db, issueId, subArgs.slice(2).join(" "));
            break;
          }
          case "list":
            await issueList(db, projectId, subArgs[1]);
            break;
          default:
            console.error("Usage: muninn issue <add|resolve|list> [args]");
        }
        break;
      }

      case "learn":
      case "l": {
        const learnCmd = subArgs[0];
        switch (learnCmd) {
          case "add":
            await learnAdd(db, projectId, subArgs.slice(1));
            break;
          case "list":
            await learnList(db, projectId);
            break;
          case "reinforce":
            await handleReinforceCommand(db, projectId, subArgs.slice(1));
            break;
          case "history":
            await handleHistoryCommand(db, projectId, subArgs.slice(1));
            break;
          case "conflicts":
            await handleConflictsCommand(db, projectId, subArgs.slice(1));
            break;
          default:
            console.error("Usage: muninn learn <add|list|reinforce|history|conflicts> [args]");
            console.error("");
            console.error("Commands:");
            console.error("  add <title> --content <content>  Add a new learning");
            console.error("  list                             List all learnings");
            console.error("  reinforce <id>                   Boost confidence and reset decay timer");
            console.error("  history <id>                     Show version history of a learning");
            console.error("  conflicts [list|resolve]         Manage learning contradictions");
        }
        break;
      }

      // Continuity commands
      case "observe":
      case "obs":
        await handleObserveCommand(db, projectId, subArgs);
        break;

      case "questions":
      case "q?":
        await handleQuestionsCommand(db, projectId, subArgs);
        break;

      case "workflow":
      case "wf":
        await handleWorkflowCommand(db, projectId, subArgs);
        break;

      case "profile":
        await handleProfileCommand(db, projectId, subArgs);
        break;

      case "outcome":
        await handleOutcomeCommand(db, projectId, subArgs);
        break;

      case "foundational":
        await handleFoundationalCommand(db, projectId, subArgs);
        break;

      case "promote":
        await handlePromotionCommand(db, projectId, process.cwd(), subArgs);
        break;

      case "temporal":
        await handleTemporalCommand(db, projectId, subArgs);
        break;

      case "predict":
        await handlePredictCommand(db, projectId, subArgs);
        break;

      case "enrich":
        await handleEnrichCommand(db, projectId, process.cwd(), subArgs);
        break;

      case "approve":
        await handleApproveCommand(db, subArgs);
        break;

      case "enrich-status":
        await handleEnrichmentStatusCommand();
        break;

      case "suggest":
        await handleSuggestCommand(db, projectId, subArgs);
        break;

      case "insights":
        await handleInsightsCommand(db, projectId, subArgs);
        break;

      case "relate":
        await handleRelationshipCommand(db, projectId, ["add", ...subArgs]);
        break;

      case "relations":
        await handleRelationshipCommand(db, projectId, ["list", ...subArgs]);
        break;

      case "unrelate":
        await handleRelationshipCommand(db, projectId, ["remove", ...subArgs]);
        break;

      case "consolidate":
        await handleConsolidationCommand(db, projectId, subArgs);
        break;

      case "convo":
      case "conversations":
        await handleConversationsCommand(db, projectId, subArgs);
        break;

      case "session":
      case "s": {
        const sessCmd = subArgs[0];
        switch (sessCmd) {
          case "start": {
            const newSessionId = await sessionStart(db, projectId, subArgs.slice(1).join(" "));
            await incrementSessionsSince(db, projectId);
            await assignSessionNumber(db, projectId, newSessionId);
            break;
          }
          case "end": {
            // Use enhanced session end with auto-learning extraction
            await sessionEndEnhanced(db, projectId, parseInt(subArgs[1], 10), subArgs.slice(2));
            // Update file velocities from session
            const endedSession = await db.get<{ files_touched: string | null }>(
              "SELECT files_touched FROM sessions WHERE id = ?",
              [parseInt(subArgs[1], 10)]
            );
            if (endedSession?.files_touched) {
              try {
                const touchedFiles = JSON.parse(endedSession.files_touched);
                await updateFileVelocity(db, projectId, touchedFiles);
              } catch {
                /* invalid JSON */
              }
            }
            // Generate insights non-blocking (best effort)
            try {
              await generateInsights(db, projectId);
            } catch {
              /* optional */
            }
            break;
          }
          case "last":
            await sessionLast(db, projectId);
            break;
          case "list":
            await sessionList(db, projectId);
            break;
          case "count": {
            const count = await sessionCount(db, projectId);
            console.error(`Total sessions: ${count}`);
            outputJson({ count });
            break;
          }
          case "correlations":
          case "corr":
            await handleCorrelationCommand(db, projectId, subArgs.slice(1));
            break;
          default:
            console.error("Usage: muninn session <start|end|last|list|count|correlations> [args]");
        }
        break;
      }

      case "status":
        await showStatus(db, projectId);
        break;

      case "fragile":
        await showFragile(db, projectId);
        break;

      case "brief": {
        const brief = await generateBrief(db, projectId, process.cwd());
        console.error(brief);
        outputSuccess({ markdown: brief });
        break;
      }

      case "resume": {
        const resume = await generateResume(db, projectId);
        console.error(resume);
        outputSuccess({ markdown: resume });
        break;
      }

      case "startup": {
        const startupGoal = subArgs.join(" ") || "New session";
        const startupResult = await fastStartup(db, projectId, process.cwd(), startupGoal);
        outputJson(startupResult);
        break;
      }

      case "analyze": {
        const analysis = await runAnalysis(db, projectId, process.cwd());
        outputSuccess({
          project: analysis.project,
          filesAnalyzed: analysis.files?.length || 0,
          decisionsFound: analysis.decisions?.length || 0,
          issuesFound: analysis.potential_issues?.length || 0,
          techDebtFound: analysis.tech_debt?.length || 0,
        });
        break;
      }

      case "ship":
        await handleShipCommand(db, projectId, process.cwd());
        break;

      // Intelligence commands
      case "check":
        if (subArgs.length === 0) {
          console.error("Usage: muninn check <file1> [file2] ...");
        } else {
          await checkFiles(db, projectId, process.cwd(), subArgs);
        }
        break;

      case "impact":
        if (subArgs.length === 0) {
          console.error("Usage: muninn impact <file>");
        } else {
          await analyzeImpact(db, projectId, process.cwd(), subArgs[0]);
        }
        break;

      case "smart-status":
      case "ss":
        await getSmartStatus(db, projectId, process.cwd());
        break;

      case "drift":
        await detectDrift(db, projectId, process.cwd());
        break;

      case "conflicts":
        if (subArgs.length === 0) {
          console.error("Usage: muninn conflicts <file1> [file2] ...");
        } else {
          await checkConflicts(db, projectId, process.cwd(), subArgs);
        }
        break;

      case "git-info":
        outputSuccess(getGitInfo(process.cwd()));
        break;

      case "sync-hashes":
        await syncFileHashes(db, projectId, process.cwd());
        break;

      // Dependency commands
      case "deps":
        if (subArgs.includes("--refresh")) {
          await refreshDependencies(db, projectId, process.cwd());
        } else if (subArgs.includes("--graph")) {
          const focusFile = subArgs.find((a) => !a.startsWith("--"));
          await generateDependencyGraph(db, projectId, process.cwd(), focusFile);
        } else if (subArgs.includes("--cycles")) {
          findCircularDependencies(process.cwd());
        } else if (subArgs.length > 0 && !subArgs[0].startsWith("--")) {
          await showDependencies(db, projectId, process.cwd(), subArgs[0]);
        } else {
          console.error("Usage: muninn deps <file> | --refresh | --graph [file] | --cycles");
        }
        break;

      // Blast radius commands
      case "blast":
        if (subArgs.includes("--refresh")) {
          await computeBlastRadius(db, projectId, process.cwd());
        } else if (subArgs.includes("--high")) {
          await showHighImpactFiles(db, projectId);
        } else if (subArgs.length > 0 && !subArgs[0].startsWith("--")) {
          await showBlastRadius(db, projectId, process.cwd(), subArgs[0]);
        } else {
          console.error("Usage: muninn blast <file> | --refresh | --high");
        }
        break;

      // Working memory commands
      case "bookmark":
      case "bm":
        await handleBookmarkCommand(db, projectId, subArgs);
        break;

      // Focus commands
      case "focus":
        await handleFocusCommand(db, projectId, subArgs);
        break;

      // Database commands
      case "db":
        await handleDatabaseCommand(db, subArgs);
        break;

      // Hook commands (for automation)
      case "hook": {
        const hookCmd = subArgs[0];
        switch (hookCmd) {
          case "check": {
            const hookFiles = subArgs.slice(1).filter((a) => !a.startsWith("--"));
            const thresholdIdx = subArgs.indexOf("--threshold");
            const threshold = thresholdIdx !== -1 ? parseInt(subArgs[thresholdIdx + 1], 10) : 7;
            if (hookFiles.length === 0) {
              console.error("Usage: muninn hook check <file1> [file2] [--threshold N]");
              process.exit(1);
            }
            await hookCheck(db, projectId, process.cwd(), hookFiles, threshold);
            break;
          }
          case "init":
            await hookInit(db, projectId, process.cwd());
            break;
          case "post-edit":
            if (!subArgs[1]) {
              console.error("Usage: muninn hook post-edit <file>");
              process.exit(1);
            }
            await hookPostEdit(db, projectId, subArgs[1]);
            break;
          case "brain":
            await hookBrain(db, projectId, process.cwd());
            break;
          default:
            console.error("Usage: muninn hook <check|init|post-edit|brain>");
            process.exit(1);
        }
        break;
      }

      case "dashboard": {
        const portIdx = subArgs.indexOf("--port");
        let port = 3333;
        if (portIdx !== -1) {
          const portArg = subArgs[portIdx + 1];
          const { SafePort } = await import("./mcp-validation");
          const portResult = SafePort.safeParse(portArg);
          if (!portResult.success) {
            console.error(`Invalid port: ${portArg}. Must be 1-65535.`);
            process.exit(1);
          }
          port = portResult.data;
        }
        const shouldOpen = subArgs.includes("--open");

        const { createApp } = await import("./web-server");
        const app = createApp();

        console.error(`\n🌌 Muninn Dashboard`);
        console.error(`   http://localhost:${port}\n`);

        Bun.serve({ fetch: app.fetch, port });

        if (shouldOpen) {
          const { spawn } = await import("node:child_process");
          const openCmd =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "cmd"
                : "xdg-open";
          const args =
            process.platform === "win32"
              ? ["/c", "start", `http://localhost:${port}`]
              : [`http://localhost:${port}`];
          spawn(openCmd, args, { detached: true, stdio: "ignore" }).unref();
        }

        // Keep process running until SIGTERM/SIGINT
        await new Promise<void>((resolve) => {
          process.on("SIGTERM", resolve);
          process.on("SIGINT", resolve);
        });
        break;
      }

      // v4: Install git hook
      case "install-hook": {
        const gitDir = await (async () => {
          try {
            const proc = Bun.spawn(["git", "rev-parse", "--git-dir"], { stdout: "pipe", stderr: "pipe" });
            const out = await new Response(proc.stdout).text();
            await proc.exited;
            return out.trim() || null;
          } catch {
            return null;
          }
        })();
        if (!gitDir) {
          console.error("Not in a git repository");
          process.exit(1);
        }
        const hooksDir = join(gitDir, "hooks");
        const hookFile = join(hooksDir, "post-commit");
        const { mkdirSync, existsSync: fsExists, readFileSync: fsRead, appendFileSync, writeFileSync: fsWrite } = await import("node:fs");
        mkdirSync(hooksDir, { recursive: true });
        const hookSnippet = `\n# Muninn: auto-ingest git commits (background, non-blocking)\nif command -v muninn &> /dev/null; then\n    muninn ingest commit &>/dev/null &\nfi\n`;
        if (fsExists(hookFile)) {
          const existing = fsRead(hookFile, "utf-8");
          if (existing.includes("muninn ingest commit")) {
            console.error("Git hook already installed");
          } else {
            appendFileSync(hookFile, hookSnippet);
            const { chmodSync } = await import("node:fs");
            chmodSync(hookFile, 0o755);
            console.error("Git post-commit hook updated with muninn ingestion");
          }
        } else {
          fsWrite(hookFile, `#!/bin/bash${hookSnippet}`);
          const { chmodSync } = await import("node:fs");
          chmodSync(hookFile, 0o755);
          console.error("Git post-commit hook installed");
        }
        break;
      }

      // v4: Ingestion commands
      case "ingest": {
        const ingestCmd = subArgs[0];
        switch (ingestCmd) {
          case "commit": {
            const { processCommit } = await import("./ingestion/git-hook");
            const result = await processCommit(db, projectId);
            console.error(result);
            break;
          }
          case "worker": {
            // Run background worker inline (for manual triggering)
            const { spawn } = await import("node:child_process");
            const workerArgs = subArgs.slice(1);
            const scriptDir = import.meta.dir;
            const workerPath = join(scriptDir, "worker.ts");
            const child = spawn("bun", ["run", workerPath, ...workerArgs], {
              detached: true,
              stdio: "ignore",
              env: { ...process.env },
            });
            child.unref();
            console.error("Worker spawned in background");
            break;
          }
          default:
            console.error("Usage: muninn ingest <commit|worker>");
        }
        break;
      }

      default:
        console.log(HELP_TEXT);
    }
  } finally {
    await shutdown(0);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

// Hard ceiling: no CLI invocation should ever run longer than 2 minutes.
// This catches hung API calls, stuck DB queries, or anything else that
// prevents main() from reaching the finally block.
import { safeTimeout } from "./utils/timers";
safeTimeout(() => process.exit(0), 120_000);

// Register cleanup in order: flush queued writes, then close DB handles
onShutdown(() => flushFileUpdates());
onShutdown(() => closeAll());

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
