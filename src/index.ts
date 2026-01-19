#!/usr/bin/env bun
/**
 * Claude Context Engine v3 — Elite Mode
 * Main CLI entry point
 */

import { getGlobalDb, getProjectDb, initProjectDb, ensureProject, closeAll, getProjectDbPath, LOCAL_DB_DIR, LOCAL_DB_NAME } from "./database/connection";
import { handleInfraCommand } from "./commands/infra";
import { handleQueryCommand } from "./commands/query";
import { runAnalysis, showStatus, showFragile, generateBrief, showStack } from "./commands/analysis";
import { fileAdd, fileGet, fileList, decisionAdd, decisionList, issueAdd, issueResolve, issueList, learnAdd, learnList, patternAdd, patternSearch, patternList, debtAdd, debtList, debtResolve } from "./commands/memory";
import { sessionStart, sessionEnd, sessionLast, sessionList, generateResume } from "./commands/session";
import { handleShipCommand } from "./commands/ship";
import { outputSuccess } from "./utils/format";
import { existsSync } from "fs";
import { join } from "path";

// ============================================================================
// Help Text
// ============================================================================

const HELP_TEXT = `Claude Context Engine v3 — Elite Mode

🔒 Security Commands:
  secure [files...]           OWASP security scan (SQL injection, XSS, etc.)
  secrets [files...]          Detect hardcoded secrets and API keys
  audit                       Check dependencies for vulnerabilities

📊 Quality Commands:
  quality [files...]          Code quality analysis (complexity, types, etc.)
  types                       Check TypeScript type coverage
  test-gen <file>             Generate Vitest tests for a file
  ship                        Pre-deploy checklist
  review <file>               AI code review

⚡ Performance Commands:
  perf [files...]             Detect performance issues (N+1, sync ops, etc.)
  queries                     Analyze database query patterns

📈 Growth Commands:
  growth                      Analyze virality potential
  scaffold <type>             Generate growth features (referral, share, invite)

🧠 Intelligence Commands:
  brief                       Smart session brief (markdown summary)
  resume                      Resume from last session
  drift                       Detect knowledge drift (stale + git changes)
  smart-status (ss)           Actionable status with recommendations
  suggest <task>              AI suggests files for your task
  check <files...>            Pre-edit warnings for files
  impact <file>               Analyze change impact
  conflicts <files...>        Check if files changed since last query
  hooks                       Install git hooks for auto-updates

📁 Project Commands:
  init                        Initialize context DB for current project
  analyze                     Auto-analyze project with Claude API
  status                      Current project state (JSON)
  fragile                     List fragile files
  query <text> [--smart]      Search context (--smart uses Claude re-ranking)

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

  session start <goal>        Start a work session
  session end <id> [options]  End a session
  session last                Get last session

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
        handleQueryCommand(db, projectId, subArgs);
        break;

      case "file":
      case "f":
        const fileCmd = subArgs[0];
        switch (fileCmd) {
          case "add":
            fileAdd(db, projectId, subArgs.slice(1));
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
            decisionAdd(db, projectId, subArgs.slice(1));
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
            issueAdd(db, projectId, subArgs.slice(1));
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
            learnAdd(db, projectId, subArgs.slice(1));
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
