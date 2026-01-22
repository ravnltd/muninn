#!/usr/bin/env bun
/**
 * Claude Context Engine v3 — Elite Mode
 * Main CLI entry point
 */

import { getGlobalDb, getProjectDb, initProjectDb, ensureProject, closeAll, getProjectDbPath, LOCAL_DB_DIR, LOCAL_DB_NAME, getSchemaVersion, getLatestVersion, checkIntegrity } from "./database/connection";
import { getRecentErrors, optimizeDatabase, getPendingMigrations, runMigrations } from "./database/migrations";
import { handleInfraCommand } from "./commands/infra";
import { handleQueryCommand } from "./commands/query";
import { runAnalysis, showStatus, showFragile, generateBrief, showStack } from "./commands/analysis";
import { fileAdd, fileGet, fileList, decisionAdd, decisionList, issueAdd, issueResolve, issueList, learnAdd, learnList, patternAdd, patternSearch, patternList, debtAdd, debtList, debtResolve } from "./commands/memory";
import { sessionStart, sessionEnd, sessionLast, sessionList, generateResume } from "./commands/session";
import { handleShipCommand } from "./commands/ship";
import { handleEmbedCommand } from "./commands/embed";
import { checkFiles, analyzeImpact, getSmartStatus, checkConflicts } from "./commands/intelligence";
import { detectDrift, getGitInfo, syncFileHashes } from "./commands/git";
import { showDependencies, refreshDependencies, generateDependencyGraph, findCircularDependencies } from "./commands/deps";
import { handleBookmarkCommand } from "./commands/bookmark";
import { handleFocusCommand } from "./commands/focus";
import { hookCheck, hookInit, hookPostEdit, hookBrain } from "./commands/hooks";
import { outputSuccess } from "./utils/format";
import { existsSync } from "fs";
import { join } from "path";

// ============================================================================
// Help Text
// ============================================================================

const HELP_TEXT = `Claude Context Engine v3 — Elite Mode

🧠 Intelligence Commands:
  check <files...>            Pre-edit warnings (fragility, issues, staleness)
  impact <file>               Analyze what depends on this file
  smart-status (ss)           Actionable status with recommendations
  drift                       Detect knowledge drift (stale files + git changes)
  conflicts <files...>        Check if files changed since last query
  brief                       Smart session brief (markdown summary)
  resume                      Resume from last session

📌 Working Memory Commands:
  bookmark add [options]      Save context for later recall
  bookmark get <label>        Retrieve bookmarked content
  bookmark list               List all bookmarks
  bookmark delete <label>     Delete a bookmark
  bookmark clear              Clear all bookmarks

🎯 Focus Commands:
  focus set <area>            Set current work area (boosts related queries)
  focus get                   Show current focus
  focus clear                 Clear current focus
  focus list                  Show focus history

🪝 Hook Commands (for automation):
  hook check <files...>       Pre-edit check (exits 1 if fragility >= threshold)
  hook init                   Session initialization context
  hook post-edit <file>       Post-edit memory update reminder
  hook brain                  Full brain dump for session start

📦 Dependency Commands:
  deps <file>                 Show imports and dependents for a file
  deps --refresh              Rebuild dependency graph for all files
  deps --graph [file]         Generate Mermaid dependency diagram
  deps --cycles               Find circular dependencies

📁 Project Commands:
  init                        Initialize context DB for current project
  analyze                     Auto-analyze project with Claude API
  status                      Current project state (JSON)
  fragile                     List fragile files
  query <text> [options]      Search context (--smart, --vector, --fts, --brief)
  ship                        Pre-deploy checklist

🔍 Vector Search Commands:
  embed status                Show embedding coverage statistics
  embed backfill [table]      Generate missing embeddings
  embed test "text"           Test embedding generation

📝 Memory Commands:
  file add <path> [options]   Add/update file knowledge
  file get <path>             Get file details
  file list [filter]          List known files

  decision add [options]      Record a decision
  decision list               List active decisions

  issue add [options]         Record an issue
  issue resolve <id> <text>   Mark issue resolved
  issue list [status]         List issues

  learn add [options]         Record a learning (--global for cross-project)
  learn list                  List learnings

📋 Session Commands:
  session start <goal>        Start a work session
  session end <id> [options]  End a session
  session last                Get last session
  session list                List recent sessions

🌐 Global Commands:
  pattern add [options]       Add a reusable pattern
  pattern search <query>      Search patterns
  pattern list                List all patterns

  debt list [--project]       List tech debt
  debt add [options]          Add tech debt item
  debt resolve <id>           Mark debt resolved

  stack                       Show preferred tech stack

🏗️ Infrastructure Commands:
  infra server add/list/remove/check
  infra service add/list/remove/status/logs
  infra route add/list/remove/check
  infra dep add/list
  infra status/map/events/check

🔧 Database Commands:
  db check                    Verify schema integrity
  db version                  Show current schema version
  db migrate                  Apply pending migrations
  db errors [N]               Show recent errors (default 20)
  db optimize                 Run WAL checkpoint and optimize

Run 'context <command> --help' for more information on a command.
`;

// ============================================================================
// Main CLI Router
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subArgs = args.slice(1);

  // Handle help
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP_TEXT);
    return;
  }

  // Handle init (creates project DB)
  if (command === "init") {
    const db = initProjectDb(process.cwd());
    const projectId = ensureProject(db);
    console.error(`✅ Context initialized for ${process.cwd()}`);
    outputSuccess({
      projectId,
      dbPath: join(process.cwd(), LOCAL_DB_DIR, LOCAL_DB_NAME),
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
    const globalDb = getGlobalDb();
    const subCmd = subArgs[0];

    try {
      if (subCmd === "add") {
        patternAdd(globalDb, subArgs.slice(1));
      } else if (subCmd === "search" || subCmd === "find") {
        const query = subArgs.slice(1).join(" ");
        patternSearch(globalDb, query);
      } else if (subCmd === "list") {
        patternList();
      } else {
        console.error("Usage: context pattern <add|search|list>");
      }
    } finally {
      closeAll();
    }
    return;
  }

  // Handle debt commands (uses global DB)
  if (command === "debt") {
    const subCmd = subArgs[0];

    if (subCmd === "list") {
      debtList(subArgs.includes("--project"));
    } else if (subCmd === "add") {
      debtAdd(subArgs.slice(1));
    } else if (subCmd === "resolve") {
      debtResolve(parseInt(subArgs[1]));
    } else {
      console.error("Usage: context debt <list|add|resolve>");
    }
    closeAll();
    return;
  }

  // Handle stack command
  if (command === "stack") {
    showStack();
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
            console.error("Usage: context file <add|get|list> [args]");
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
            console.error("Usage: context decision <add|list> [args]");
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
            console.error("Usage: context issue <add|resolve|list> [args]");
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
            console.error("Usage: context learn <add|list> [args]");
        }
        break;

      case "session":
      case "s":
        const sessCmd = subArgs[0];
        switch (sessCmd) {
          case "start":
            sessionStart(db, projectId, subArgs.slice(1).join(" "));
            break;
          case "end":
            sessionEnd(db, parseInt(subArgs[1]), subArgs.slice(2));
            break;
          case "last":
            sessionLast(db, projectId);
            break;
          case "list":
            sessionList(db, projectId);
            break;
          default:
            console.error("Usage: context session <start|end|last|list> [args]");
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
          console.error("Usage: context check <file1> [file2] ...");
        } else {
          checkFiles(db, projectId, process.cwd(), subArgs);
        }
        break;

      case "impact":
        if (subArgs.length === 0) {
          console.error("Usage: context impact <file>");
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
          console.error("Usage: context conflicts <file1> [file2] ...");
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
          console.error("Usage: context deps <file> | --refresh | --graph [file] | --cycles");
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
        const dbCmd = subArgs[0];
        switch (dbCmd) {
          case "check": {
            const integrity = checkIntegrity(db);
            console.error(`\n🔍 Database Integrity Check\n`);
            console.error(`Version: ${integrity.version}/${getLatestVersion()}`);
            console.error(`Status: ${integrity.valid ? '✅ Valid' : '❌ Issues Found'}\n`);

            if (integrity.issues.length > 0) {
              console.error('Issues:');
              for (const issue of integrity.issues) {
                console.error(`  ⚠️  ${issue}`);
              }
              console.error('');
            }

            const missingTables = integrity.tables.filter(t => !t.exists);
            if (missingTables.length > 0) {
              console.error(`Missing tables: ${missingTables.map(t => t.name).join(', ')}`);
            }

            const missingIndexes = integrity.indexes.filter(i => !i.exists);
            if (missingIndexes.length > 0) {
              console.error(`Missing indexes: ${missingIndexes.map(i => i.name).join(', ')}`);
            }

            outputSuccess(integrity);
            break;
          }

          case "version": {
            const current = getSchemaVersion(db);
            const latest = getLatestVersion();
            const pending = getPendingMigrations(db);
            console.error(`Schema version: ${current}/${latest}`);
            if (pending.length > 0) {
              console.error(`Pending migrations: ${pending.length}`);
              for (const m of pending) {
                console.error(`  - v${m.version}: ${m.name}`);
              }
            }
            outputSuccess({ current, latest, pending: pending.length });
            break;
          }

          case "migrate": {
            console.error('Running migrations...');
            const result = runMigrations(db, getProjectDbPath());
            if (result.ok) {
              if (result.value.applied.length === 0) {
                console.error('✅ Already up to date');
              } else {
                console.error(`✅ Applied ${result.value.applied.length} migration(s)`);
                for (const m of result.value.applied) {
                  console.error(`  - v${m.version}: ${m.name} (${m.duration_ms}ms)`);
                }
              }
              outputSuccess(result.value);
            } else {
              console.error(`❌ Migration failed: ${result.error.message}`);
              process.exit(1);
            }
            break;
          }

          case "errors": {
            const limit = parseInt(subArgs[1]) || 20;
            const errors = getRecentErrors(db, limit);
            if (errors.length === 0) {
              console.error('No recent errors');
            } else {
              console.error(`\n📋 Recent Errors (${errors.length})\n`);
              for (const err of errors) {
                console.error(`[${err.timestamp}] [${err.source}] ${err.message}`);
              }
            }
            outputSuccess({ count: errors.length, errors });
            break;
          }

          case "optimize": {
            console.error('Optimizing database...');
            optimizeDatabase(db);
            console.error('✅ Database optimized');
            outputSuccess({ optimized: true });
            break;
          }

          default:
            console.error("Usage: context db <check|version|migrate|errors|optimize>");
        }
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
              console.error("Usage: context hook check <file1> [file2] [--threshold N]");
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
              console.error("Usage: context hook post-edit <file>");
              process.exit(1);
            }
            hookPostEdit(db, projectId, subArgs[1]);
            break;
          case "brain":
            hookBrain(db, projectId, process.cwd());
            break;
          default:
            console.error("Usage: context hook <check|init|post-edit|brain>");
            process.exit(1);
        }
        break;

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
