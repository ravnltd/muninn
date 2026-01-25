#!/usr/bin/env bun
/**
 * Muninn — Elite Mode
 * Main CLI entry point
 */

import { getGlobalDb, getProjectDb, initProjectDb, ensureProject, closeAll, getProjectDbPath, LOCAL_DB_DIR, LOCAL_DB_NAME } from "./database/connection";
import { handleInfraCommand } from "./commands/infra";
import { handleQueryCommand } from "./commands/query";
import { runAnalysis, showStatus, showFragile, generateBrief } from "./commands/analysis";
import { fileAdd, fileGet, fileList, decisionAdd, decisionList, issueAdd, issueResolve, issueList, learnAdd, learnList } from "./commands/memory";
import { HELP_TEXT } from "./help";
import { handleDatabaseCommand } from "./commands/database";
import { handlePatternCommand, handleDebtCommand, handleStackCommand } from "./commands/global";
import { sessionStart, sessionLast, sessionList, sessionCount, generateResume, sessionEndEnhanced, handleCorrelationCommand } from "./commands/session";
import { handleShipCommand } from "./commands/ship";
import { handleEmbedCommand } from "./commands/embed";
import { checkFiles, analyzeImpact, getSmartStatus, checkConflicts } from "./commands/intelligence";
import { detectDrift, getGitInfo, syncFileHashes } from "./commands/git";
import { showDependencies, refreshDependencies, generateDependencyGraph, findCircularDependencies } from "./commands/deps";
import { computeBlastRadius, showBlastRadius, showHighImpactFiles } from "./commands/blast";
import { handleBookmarkCommand } from "./commands/bookmark";
import { handleFocusCommand } from "./commands/focus";
import { hookCheck, hookInit, hookPostEdit, hookBrain } from "./commands/hooks";
import { handleChunkCommand } from "./commands/chunk";
import { handleObserveCommand } from "./commands/observe";
import { handleQuestionsCommand } from "./commands/questions";
import { handleWorkflowCommand } from "./commands/workflow";
import { handleProfileCommand } from "./commands/profile";
import { handleOutcomeCommand, incrementSessionsSince } from "./commands/outcomes";
import { handleTemporalCommand, updateFileVelocity, assignSessionNumber } from "./commands/temporal";
import { handlePredictCommand } from "./commands/predict";
import { handleSuggestCommand } from "./commands/suggest";
import { handleInsightsCommand, generateInsights } from "./commands/insights";
import { handleRelationshipCommand } from "./commands/relationships";
import { handleConsolidationCommand } from "./commands/consolidation";
import { outputSuccess, outputJson } from "./utils/format";
import { CLAUDE_MD_TEMPLATE, getMuninnSection, MUNINN_SECTION_START, MUNINN_SECTION_END } from "./templates/claude-md";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

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
    const db = initProjectDb(process.cwd());
    const projectId = ensureProject(db);

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
        const updated = existing.trimEnd() + "\n" + getMuninnSection();
        writeFileSync(claudeMdPath, updated);
        claudeMdAction = "updated";
        console.error(`📄 Added muninn section to existing CLAUDE.md`);
      } else {
        // Already has muninn section - update it
        const before = existing.split(MUNINN_SECTION_START)[0];
        const after = existing.split(MUNINN_SECTION_END)[1] || "";
        const updated = before.trimEnd() + "\n" + getMuninnSection() + after.trimStart();
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
    const globalDb = getGlobalDb();
    try {
      await handleInfraCommand(globalDb, subArgs);
    } finally {
      closeAll();
    }
    return;
  }

  // Handle pattern commands (uses global DB only)
  if (command === "pattern") {
    handlePatternCommand(getGlobalDb(), subArgs);
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
  let db;
  const dbPath = getProjectDbPath();

  // Auto-init if no DB exists
  if (!existsSync(dbPath) && dbPath.includes(LOCAL_DB_DIR)) {
    console.error("📁 No context database found. Initializing...\n");
    db = initProjectDb(process.cwd());
  } else if (command === "analyze" && !existsSync(join(process.cwd(), LOCAL_DB_DIR, LOCAL_DB_NAME))) {
    // Allow analyze to init if needed
    db = initProjectDb(process.cwd());
  } else {
    db = getProjectDb();
  }

  const projectId = ensureProject(db);

  try {
    switch (command) {
      case "query":
      case "q":
        await handleQueryCommand(db, projectId, subArgs);
        break;

      case "embed":
        await handleEmbedCommand(db, projectId, subArgs);
        break;

      case "chunk":
        await handleChunkCommand(db, projectId, process.cwd(), subArgs);
        break;

      case "file":
      case "f":
        const fileCmd = subArgs[0];
        switch (fileCmd) {
          case "add":
            await fileAdd(db, projectId, subArgs.slice(1));
            break;
          case "get":
            fileGet(db, projectId, subArgs[1]);
            break;
          case "list":
            fileList(db, projectId, subArgs[1]);
            break;
          default:
            console.error("Usage: muninn file <add|get|list> [args]");
        }
        break;

      case "decision":
      case "d":
        const decCmd = subArgs[0];
        switch (decCmd) {
          case "add":
            await decisionAdd(db, projectId, subArgs.slice(1));
            break;
          case "list":
            decisionList(db, projectId);
            break;
          default:
            console.error("Usage: muninn decision <add|list> [args]");
        }
        break;

      case "issue":
      case "i":
        const issueCmd = subArgs[0];
        switch (issueCmd) {
          case "add":
            await issueAdd(db, projectId, subArgs.slice(1));
            break;
          case "resolve":
            issueResolve(db, parseInt(subArgs[1]), subArgs.slice(2).join(" "));
            break;
          case "list":
            issueList(db, projectId, subArgs[1]);
            break;
          default:
            console.error("Usage: muninn issue <add|resolve|list> [args]");
        }
        break;

      case "learn":
      case "l":
        const learnCmd = subArgs[0];
        switch (learnCmd) {
          case "add":
            await learnAdd(db, projectId, subArgs.slice(1));
            break;
          case "list":
            learnList(db, projectId);
            break;
          default:
            console.error("Usage: muninn learn <add|list> [args]");
        }
        break;

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
        handleWorkflowCommand(db, projectId, subArgs);
        break;

      case "profile":
        handleProfileCommand(db, projectId, subArgs);
        break;

      case "outcome":
        handleOutcomeCommand(db, projectId, subArgs);
        break;

      case "temporal":
        handleTemporalCommand(db, projectId, subArgs);
        break;

      case "predict":
        handlePredictCommand(db, projectId, subArgs);
        break;

      case "suggest":
        await handleSuggestCommand(db, projectId, subArgs);
        break;

      case "insights":
        handleInsightsCommand(db, projectId, subArgs);
        break;

      case "relate":
        handleRelationshipCommand(db, projectId, ["add", ...subArgs]);
        break;

      case "relations":
        handleRelationshipCommand(db, projectId, ["list", ...subArgs]);
        break;

      case "unrelate":
        handleRelationshipCommand(db, projectId, ["remove", ...subArgs]);
        break;

      case "consolidate":
        await handleConsolidationCommand(db, projectId, subArgs);
        break;

      case "session":
      case "s":
        const sessCmd = subArgs[0];
        switch (sessCmd) {
          case "start": {
            const newSessionId = sessionStart(db, projectId, subArgs.slice(1).join(" "));
            incrementSessionsSince(db, projectId);
            assignSessionNumber(db, projectId, newSessionId);
            break;
          }
          case "end": {
            // Use enhanced session end with auto-learning extraction
            await sessionEndEnhanced(db, projectId, parseInt(subArgs[1]), subArgs.slice(2));
            // Update file velocities from session
            const endedSession = db.query<{ files_touched: string | null }, [number]>(
              "SELECT files_touched FROM sessions WHERE id = ?"
            ).get(parseInt(subArgs[1]));
            if (endedSession?.files_touched) {
              try {
                const touchedFiles = JSON.parse(endedSession.files_touched);
                updateFileVelocity(db, projectId, touchedFiles);
              } catch { /* invalid JSON */ }
            }
            // Generate insights non-blocking (best effort)
            try { generateInsights(db, projectId); } catch { /* optional */ }
            break;
          }
          case "last":
            sessionLast(db, projectId);
            break;
          case "list":
            sessionList(db, projectId);
            break;
          case "count": {
            const count = sessionCount(db, projectId);
            console.error(`Total sessions: ${count}`);
            outputJson({ count });
            break;
          }
          case "correlations":
          case "corr":
            handleCorrelationCommand(db, projectId, subArgs.slice(1));
            break;
          default:
            console.error("Usage: muninn session <start|end|last|list|count|correlations> [args]");
        }
        break;

      case "status":
        showStatus(db, projectId);
        break;

      case "fragile":
        showFragile(db, projectId);
        break;

      case "brief":
        const brief = generateBrief(db, projectId, process.cwd());
        console.error(brief);
        outputSuccess({ markdown: brief });
        break;

      case "resume":
        const resume = generateResume(db, projectId);
        console.error(resume);
        outputSuccess({ markdown: resume });
        break;

      case "analyze":
        const analysis = await runAnalysis(db, projectId, process.cwd());
        outputSuccess({
          project: analysis.project,
          filesAnalyzed: analysis.files.length,
          decisionsFound: analysis.decisions.length,
          issuesFound: analysis.potential_issues.length,
          techDebtFound: analysis.tech_debt?.length || 0,
        });
        break;

      case "ship":
        await handleShipCommand(db, projectId, process.cwd());
        break;

      // Intelligence commands
      case "check":
        if (subArgs.length === 0) {
          console.error("Usage: muninn check <file1> [file2] ...");
        } else {
          checkFiles(db, projectId, process.cwd(), subArgs);
        }
        break;

      case "impact":
        if (subArgs.length === 0) {
          console.error("Usage: muninn impact <file>");
        } else {
          analyzeImpact(db, projectId, process.cwd(), subArgs[0]);
        }
        break;

      case "smart-status":
      case "ss":
        getSmartStatus(db, projectId, process.cwd());
        break;

      case "drift":
        detectDrift(db, projectId, process.cwd());
        break;

      case "conflicts":
        if (subArgs.length === 0) {
          console.error("Usage: muninn conflicts <file1> [file2] ...");
        } else {
          checkConflicts(db, projectId, process.cwd(), subArgs);
        }
        break;

      case "git-info":
        outputSuccess(getGitInfo(process.cwd()));
        break;

      case "sync-hashes":
        syncFileHashes(db, projectId, process.cwd());
        break;

      // Dependency commands
      case "deps":
        if (subArgs.includes("--refresh")) {
          refreshDependencies(db, projectId, process.cwd());
        } else if (subArgs.includes("--graph")) {
          const focusFile = subArgs.find(a => !a.startsWith("--"));
          generateDependencyGraph(db, projectId, process.cwd(), focusFile);
        } else if (subArgs.includes("--cycles")) {
          findCircularDependencies(process.cwd());
        } else if (subArgs.length > 0 && !subArgs[0].startsWith("--")) {
          showDependencies(db, projectId, process.cwd(), subArgs[0]);
        } else {
          console.error("Usage: muninn deps <file> | --refresh | --graph [file] | --cycles");
        }
        break;

      // Blast radius commands
      case "blast":
        if (subArgs.includes("--refresh")) {
          computeBlastRadius(db, projectId, process.cwd());
        } else if (subArgs.includes("--high")) {
          showHighImpactFiles(db, projectId);
        } else if (subArgs.length > 0 && !subArgs[0].startsWith("--")) {
          showBlastRadius(db, projectId, process.cwd(), subArgs[0]);
        } else {
          console.error("Usage: muninn blast <file> | --refresh | --high");
        }
        break;

      // Working memory commands
      case "bookmark":
      case "bm":
        handleBookmarkCommand(db, projectId, subArgs);
        break;

      // Focus commands
      case "focus":
        handleFocusCommand(db, projectId, subArgs);
        break;

      // Database commands
      case "db":
        handleDatabaseCommand(db, subArgs);
        break;

      // Hook commands (for automation)
      case "hook":
        const hookCmd = subArgs[0];
        switch (hookCmd) {
          case "check": {
            const hookFiles = subArgs.slice(1).filter(a => !a.startsWith("--"));
            const thresholdIdx = subArgs.indexOf("--threshold");
            const threshold = thresholdIdx !== -1 ? parseInt(subArgs[thresholdIdx + 1]) : 7;
            if (hookFiles.length === 0) {
              console.error("Usage: muninn hook check <file1> [file2] [--threshold N]");
              process.exit(1);
            }
            hookCheck(db, projectId, process.cwd(), hookFiles, threshold);
            break;
          }
          case "init":
            hookInit(db, projectId, process.cwd());
            break;
          case "post-edit":
            if (!subArgs[1]) {
              console.error("Usage: muninn hook post-edit <file>");
              process.exit(1);
            }
            hookPostEdit(db, projectId, subArgs[1]);
            break;
          case "brain":
            hookBrain(db, projectId, process.cwd());
            break;
          default:
            console.error("Usage: muninn hook <check|init|post-edit|brain>");
            process.exit(1);
        }
        break;

      case "dashboard": {
        const portIdx = subArgs.indexOf("--port");
        const port = portIdx !== -1 ? parseInt(subArgs[portIdx + 1], 10) : 3333;
        const shouldOpen = subArgs.includes("--open");

        const { createApp } = await import("./web-server");
        const app = createApp();

        console.error(`\n🌌 Muninn Dashboard`);
        console.error(`   http://localhost:${port}\n`);

        Bun.serve({ fetch: app.fetch, port });

        if (shouldOpen) {
          const { exec } = await import("child_process");
          const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          exec(`${openCmd} http://localhost:${port}`);
        }

        // Keep the process running
        await new Promise(() => {});
        break;
      }

      default:
        console.log(HELP_TEXT);
    }
  } finally {
    closeAll();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

main().catch(error => {
  console.error(`❌ Error: ${error.message}`);
  process.exit(1);
});
