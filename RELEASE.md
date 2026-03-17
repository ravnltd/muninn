# Muninn v9.0.0 — The Simplification Release

## What Changed

Muninn went from 17 MCP tools to **4**. From 355 lines of ceremony instructions to **30**. From fighting Claude's natural behavior to working with it.

### Before (v8)
- 17 tools, 3 ways to search, 3 ways to record
- Mandatory workflow: predict before planning, check before every edit, file_add after every change
- Hook that blocks edits unless you called check first
- Text validation that rejects backticks and parentheses
- 9+ background jobs at session end

### After (v9)
- **4 tools**: `recall`, `remember`, `track`, `muninn`
- No mandatory steps. Use tools when they help, not because you're forced to.
- No edit blocking. No workflow enforcement.
- Natural text — write `use \`http\` mode` without validation errors
- 3 focused background jobs at session end

## Breaking Changes

### Tools Removed from MCP

| Old Tool | Replacement |
|----------|-------------|
| `muninn_query` | `recall({ query: "..." })` |
| `muninn_check` | `recall({ files: [...] })` |
| `muninn_predict` | `recall({ task: "..." })` |
| `muninn_suggest` | `recall({ task: "..." })` |
| `muninn_context` | `recall` (auto-routes by input shape) |
| `muninn_enrich` | `recall({ files: [...] })` |
| `muninn_file_add` | Automatic (git hook captures file changes) |
| `muninn_decision_add` | `remember({ content: "chose X over Y because..." })` |
| `muninn_learn_add` | `remember({ content: "always check for..." })` |
| `muninn_issue` | `track({ action: "add", title: "..." })` |
| `muninn_session` | Automatic (sessions auto-start/end) |
| `muninn_approve` | Removed (no more edit blocking) |
| `muninn_intent` | Removed |

### Passthrough Commands Reduced

28 commands reduced to 5: `status`, `reindex`, `db`, `fragile`, `outcome`. Other commands remain available via the `muninn` CLI directly.

### Hooks Removed

- `enforce-check.sh` — No longer blocks edits
- `user-prompt-context.sh` — No longer injects workflow instructions

### HTTP API Changed

| Old Endpoint | New Endpoint |
|-------------|--------------|
| `POST /api/v1/context` | `POST /api/v1/recall` |
| `POST /api/v1/memory` | `POST /api/v1/remember` |
| `POST /api/v1/session` | Removed (automatic) |
| `POST /api/v1/intent` | Removed |
| `POST /api/v1/track` | `POST /api/v1/track` (unchanged) |

### Dependencies

- Zod 3 -> 4 (breaking if you import validation schemas)

## Upgrade Guide

### One Command (recommended)

```bash
cd ~/.local/share/muninn && git pull && bun install && ./install.sh
```

This automatically:
- Updates all dependencies (including Zod v4)
- Rebuilds CLI and MCP server wrappers
- Removes old hook registrations (`enforce-check.sh`, `user-prompt-context.sh`)
- Cleans up stale hook symlinks
- Re-registers the MCP server with Claude Code

### Manual Steps (only if automatic fails)

1. Pull and install:
   ```bash
   cd ~/.local/share/muninn && git pull && bun install
   ```

2. Re-register MCP server:
   ```bash
   claude mcp remove muninn
   claude mcp add --scope user muninn -- muninn-mcp
   # For HTTP mode:
   claude mcp add --scope user muninn -- env MUNINN_MODE=http MUNINN_PRIMARY_URL=http://YOUR_HOST:8080 muninn-mcp
   ```

3. Remove old hooks from `~/.claude/settings.json`:
   - Delete the `PreToolUse` section referencing `enforce-check.sh`
   - Delete the `UserPromptSubmit` section referencing `user-prompt-context.sh`

4. Update any project CLAUDE.md files that reference old tool names.

### Data

**No data migration needed.** All existing data (decisions, learnings, files, sessions, correlations) is fully compatible. The v9 tools read from the same tables. Tables that are no longer written to remain inert but harmless.

## Stability Improvements

- **Zombie fix**: MCP server cleanly restarts instead of staying alive as a dead process
- **Circuit breaker**: 30s base cooldown reduced to 5s, 5min max reduced to 60s
- **Stale cache**: Serves cached results during outages instead of returning errors
- **Adaptive keepalive**: 60s normal, 10s recovery probe when database is unreachable
- **Degraded restart**: Auto-restarts after 10+ failures with no recovery in 60s

## Stats

- **-1,912 lines** of code removed
- **17 -> 4** MCP tools
- **28 -> 5** passthrough commands
- **9+ -> 3** session-end background jobs
- **355 -> 30** lines in CLAUDE.md
