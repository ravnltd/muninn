# Muninn

[![npm](https://img.shields.io/npm/v/muninn-ai?color=blue)](https://www.npmjs.com/package/muninn-ai)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![GitHub stars](https://img.shields.io/github/stars/ravnltd/muninn)](https://github.com/ravnltd/muninn)

**Your AI coding agent forgets everything between sessions. Muninn fixes that.**

```bash
npx muninn-ai
```

Muninn gives AI coding agents persistent memory via [MCP](https://modelcontextprotocol.io/). Before every edit, the agent knows what's fragile, what decisions were made, and what broke last time. After every session, it writes back what it learned. Knowledge compounds automatically.

> **Works with**: Claude Code, Cursor, Windsurf, Continue.dev, and any MCP-compatible tool.

---

## The Problem

AI coding agents are stateless. Every session starts from zero:

- **They break things** — editing a critical file with no idea it's fragile
- **They contradict themselves** — picking a different pattern than 3 sessions ago
- **They repeat mistakes** — re-introducing bugs that were already fixed
- **They lose context** — forgetting *why* something was done a certain way

## 4 Tools

Muninn exposes 4 tools to your AI agent:

| Tool | Purpose |
|------|---------|
| `recall` | Pre-edit context — fragility, co-changers, related decisions, open issues, blast radius |
| `remember` | Record decisions and learnings — auto-categorized, searchable across sessions |
| `track` | Bug lifecycle — add when found, resolve when fixed, surface when relevant |
| `muninn` | Everything else — status, reindex, fragile files, decision outcomes |

## What Compounds

Muninn gets smarter with every session:

- **Fragility scoring** — weighted composite of dependents, test coverage, change velocity, error history, complexity, and export surface
- **File correlations** — tracks which files change together to predict co-changes and warn about missed updates
- **Learning graduation** — patterns that prove true get promoted; contradicted ones get archived
- **Decision grounding** — architectural choices link to outcomes so the agent knows what worked and what didn't

## Quick Start

### Option 1: npx (Recommended)

```bash
npx muninn-ai
```

Installs Bun (if needed), clones the repo, registers the MCP server, and sets up hooks. One command.

### Option 2: Manual Install

```bash
git clone https://github.com/ravnltd/muninn.git ~/.local/share/muninn
cd ~/.local/share/muninn && ./install.sh
```

### First Run

On first session, Muninn auto-indexes your git history (last 100 commits) so `recall` returns useful context immediately. No setup needed.

### Multi-Editor Support

After install, Muninn auto-detects and configures:

- **Claude Code** — MCP server + session hooks
- **Cursor** — `.cursor/mcp.json`
- **Windsurf** — `.windsurf/mcp.json`
- **Continue.dev** — `.continue/config.json`

Or register manually:

```bash
muninn setup --list    # See what's detected
muninn setup --all     # Configure all detected editors
```

## Architecture

Bun + TypeScript + SQLite (via libsql/sqld). Runs as an MCP server over stdio. Local mode stores everything in `.muninn/` per-project. HTTP mode connects to a shared sqld instance for multi-machine setups.

## License

[AGPL-3.0-only](https://www.gnu.org/licenses/agpl-3.0.html) — free to use, modify, and share. If you run a modified version as a network service, you must release your source.

---

Built in collaboration with [Claude Code](https://claude.ai/code).
