# CLAUDE.md — Muninn Memory System

You have **4 MCP tools** for persistent memory. Use them naturally.

## Tools

| Tool | When | Example |
|------|------|---------|
| `recall` | Before editing unfamiliar files, or when you need context | `recall({ files: ["src/auth.ts"] })` or `recall({ query: "rate limiting" })` or `recall({ task: "fix login bug" })` |
| `remember` | When you make a non-obvious decision or learn something | `remember({ content: "chose token-bucket over sliding-window because simpler" })` |
| `track` | When you find a bug or resolve one | `track({ action: "add", title: "race condition in auth" })` |
| `muninn` | Status, reindex, fragile files, decision outcomes | `muninn({ command: "status" })` |

## Guidelines

1. **Recall before unfamiliar edits** — `recall` with files gives you fragility, co-changers, related decisions, open issues, and blast radius. It replaces check, query, predict, suggest, context, and enrich.
2. **Remember non-obvious decisions** — If you chose approach A over B for a reason, `remember` it. Auto-categorizes as decision or learning.
3. **Track bugs** — When you find or fix bugs, `track` them. It's the issue lifecycle tool.

Everything else is automatic. No mandatory steps. No ceremony.

## Architecture

- **Runtime:** Bun, TypeScript strict, SQLite via libsql/sqld
- **Hub:** sqld server (configure via `MUNINN_PRIMARY_URL`)
- **Mode:** HTTP (stateless, multi-machine) or local (single machine)
- **License:** AGPL-3.0-only

### Install / Update

```bash
# Update existing
cd ~/.local/share/muninn && git pull && bun install && ./install.sh

# Fresh install (HTTP mode)
git clone https://github.com/ravnltd/muninn.git ~/.local/share/muninn && \
cd ~/.local/share/muninn && ./install.sh && \
claude mcp add --scope user muninn -- env MUNINN_MODE=http MUNINN_PRIMARY_URL=http://YOUR_SQLD_HOST:8080 muninn-mcp
```
