# CLAUDE.md — Muninn Memory System

Muninn v10 is **push-based**: context arrives via hooks, you don't fetch it.

## What happens automatically (no action needed)

- **Session start** injects orientation: fragile files, active decisions, open issues, recent work on other projects/machines, plus global memory (`~/.muninn/context/global.md`).
- **Reading or editing a file** injects its context bundle (fragility + reason, governing decisions with full text, open issues, co-changers) — once per session, only when something non-obvious exists.
- **Your prompt** may inject a task map of likely-relevant files with purposes — trust it before reaching for Glob/Grep.
- **Edits** are tracked and the file's bundle refreshes in the background.
- **Compaction** persists a session digest to the hub (PreCompact hook).

All hook context comes from precomputed `.muninn/context/` files (refreshed by `muninn context refresh`, which runs in the background at session start/end). Hooks never hit the database synchronously.

## The 4 MCP tools (manual escape hatch)

| Tool | When | Example |
|------|------|---------|
| `recall` | Context beyond what was injected — search memory, plan a task | `recall({ query: "rate limiting" })` or `recall({ task: "fix login bug" })` |
| `remember` | Non-obvious decision or learning. Use `durability: "permanent"` for cross-project forever memory (injected everywhere via global.md) | `remember({ content: "chose token-bucket over sliding-window because simpler" })` |
| `track` | Found or fixed a bug | `track({ action: "add", title: "race condition in auth" })` |
| `muninn` | Admin: status (includes injection token ledger), reindex, outcome, list/show/search | `muninn({ command: "status" })` |

## Architecture

- **Runtime:** Bun, TypeScript strict, SQLite via libsql/sqld
- **Hub:** sqld at `MUNINN_PRIMARY_URL` (all machines share one brain)
- **Mode:** HTTP (stateless, multi-machine) or local (single machine)
- **v10 core:** `src/v9/context-cache.ts` (precompute), `src/v9/prompt-map.ts` (task map), `src/v9/purpose-summarizer.ts` (LLM purposes), `src/v9/session-digest.ts` (PreCompact), `scripts/install-hooks.ts` (6 hooks / 5 events)
- **Schema:** append-only migrations (`src/database/migrations/versions.ts`, fragility 9). Table usage map: `docs/SCHEMA-AUDIT.md`
- **License:** AGPL-3.0-only

### Install / Update

```bash
# Update existing (history was rewritten — pull may not fast-forward)
cd ~/.local/share/muninn && git fetch origin && git reset --hard origin/main && bun install && ./install.sh

# Fresh install (HTTP mode)
git clone https://github.com/ravnltd/muninn.git ~/.local/share/muninn && \
cd ~/.local/share/muninn && ./install.sh && \
claude mcp add --scope user muninn -- env MUNINN_MODE=http MUNINN_PRIMARY_URL=http://YOUR_SQLD_HOST:8080 muninn-mcp
```
