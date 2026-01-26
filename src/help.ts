/**
 * Help text and display functions
 * Extracted from index.ts for maintainability
 */

export const HELP_TEXT = `Muninn — Elite Mode

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

🔥 Blast Radius Commands:
  blast <file>                Show blast radius for a file (what breaks if changed)
  blast --refresh             Recompute blast radius for all files
  blast --high                Show high-impact files (score >= 30)

📁 Project Commands:
  init                        Initialize context DB for current project
  analyze                     Auto-analyze project with LLM API
  status                      Current project state (JSON)
  fragile                     List fragile files
  query <text> [options]      Search context (--smart, --vector, --fts, --brief)
  ship                        Pre-deploy checklist

🔍 Vector Search Commands:
  embed status                Show embedding coverage statistics
  embed backfill [table]      Generate missing embeddings
  embed test "text"           Test embedding generation

🧩 Code Chunking Commands:
  chunk run [-v]              Extract symbols from all code files
  chunk status                Show symbol statistics
  chunk search <query>        Search functions/classes/types
  chunk file <path>           Preview chunks for a single file

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

📝 Continuity Commands:
  observe <content> [options] Record an observation (--type, --global)
  observe list                List observations
  questions add <text>        Park a question for later (--priority, --context)
  questions list              Show open questions
  questions resolve <id> <text> Answer/drop a question
  workflow set <type> <approach> Record task workflow (--preferences, --global)
  workflow get <type>         Get workflow for task type
  workflow list               List all workflows

🧠 Intelligence Commands (v2):
  profile show [category]     View developer profile
  profile add <key> <value>   Declare a preference (--category, --global)
  profile infer               Auto-infer preferences from data
  predict <task> [--files f]  Bundle all relevant context for a task (FTS)
  suggest <task> [--symbols]  Suggest files using semantic search
  outcome due                 List decisions needing review
  outcome record <id> <status> Record decision outcome
  temporal velocity [file]    Show file velocity scores
  temporal anomalies          Detect unusual change patterns
  insights list [status]      List cross-session insights
  insights generate           Generate new insights from patterns
  insights ack|dismiss <id>   Acknowledge or dismiss an insight

🎓 Promotion Commands:
  promote candidates          List learnings ready for CLAUDE.md
  promote <id> [--to section] Promote learning to CLAUDE.md
  promote sync                Regenerate promoted section in CLAUDE.md
  promote stale               Find stale promoted content
  promote demote <id>         Remove learning from CLAUDE.md

📋 Session Commands:
  session start <goal>        Start a work session
  session end <id> [options]  End a session (auto-extracts learnings)
  session last                Get last session
  session list                List recent sessions
  session correlations [file] Show file change correlations

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

Run 'muninn <command> --help' for more information on a command.
`;

/**
 * Display the help text to stderr
 */
export function showHelp(): void {
  console.log(HELP_TEXT);
}
