# Muninn

[![npm](https://img.shields.io/npm/v/muninn-ai?color=blue)](https://www.npmjs.com/package/muninn-ai)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![GitHub stars](https://img.shields.io/github/stars/ravnltd/muninn)](https://github.com/ravnltd/muninn)

**Your AI coding agent forgets everything between sessions. Muninn fixes that.**

```bash
npx muninn-ai
```

Muninn gives AI coding agents persistent memory. Before every edit, the agent knows what's fragile, what decisions were made, and what broke last time. After every session, it writes back what it learned. Session 50 has the same institutional knowledge as session 1.

> **Works with**: Claude Code, Cursor, Windsurf, Continue.dev, and any MCP-compatible tool.

---

## The Problem

AI coding agents are stateless. Every session starts from zero. This means:

- **They break things** — editing a critical file with no idea it's fragile
- **They contradict themselves** — picking a different pattern than 3 sessions ago
- **They repeat mistakes** — re-introducing bugs that were already fixed
- **They lose context** — forgetting *why* something was done a certain way

The bigger the project, the worse it gets. By session 20, you're spending more time re-explaining context than writing code.

## How Muninn Fixes It

Muninn is a read-write memory loop. The agent queries context before making changes, then writes back what it learned.

```
Session starts
  -> Load last session's context, goals, next steps
  -> Surface relevant decisions, patterns, known issues

Agent edits a file
  -> Check fragility score (is this dangerous?)
  -> Surface related decisions (what was decided here before?)
  -> Warn about co-changed files (what else usually needs updating?)

Session ends
  -> Save what was done, what was learned, what's next
  -> Build cross-session insights automatically
```

After a few sessions, Muninn knows your codebase like a senior engineer who's been on the project for years.

## Quick Start

### Option 1: npx (Recommended)

```bash
npx muninn-ai
```

### Option 2: Manual Install

```bash
# Requires Bun (https://bun.sh)
git clone https://github.com/ravnltd/muninn.git ~/.local/share/muninn
cd ~/.local/share/muninn && ./install.sh
```

The installer compiles binaries, sets up hooks, and registers the MCP server automatically.

### Register with Your Editor

```bash
# Claude Code
claude mcp add --scope user muninn -- muninn-mcp

# Other MCP clients: point to the muninn-mcp binary in ~/.local/bin/
```

### Verify

```bash
muninn --help
muninn status
```

That's it. Start a coding session and Muninn auto-initializes for your project.

## What It Tracks

| Memory Type | Example | Why It Matters |
|-------------|---------|----------------|
| **Files** | `auth.ts` — fragility 8/10 | Agent asks before touching dangerous files |
| **Decisions** | "Use JWT not sessions" — because stateless deploys | Agent won't contradict past choices |
| **Issues** | Bug #12 — race condition in cache | Agent knows what's broken |
| **Learnings** | "Always validate at boundaries" | Patterns accumulate across sessions |
| **Sessions** | Last session: "Refactored auth, next: add tests" | Continuity between sessions |
| **Blast Radius** | `types.ts` impacts 47 files | Agent understands ripple effects |

## MCP Tools

10 tools available to your AI agent via [Model Context Protocol](https://modelcontextprotocol.io/):

| Tool | What It Does |
|------|--------------|
| `muninn_query` | Search memory (full-text, semantic, or LLM-ranked) |
| `muninn_check` | Pre-edit safety check (fragility, issues, co-changers) |
| `muninn_predict` | Bundle all relevant context for a task |
| `muninn_suggest` | Find related files using semantic search |
| `muninn_file_add` | Record file knowledge after editing |
| `muninn_decision_add` | Record an architectural decision |
| `muninn_learn_add` | Save a pattern or gotcha |
| `muninn_issue` | Track bugs and problems |
| `muninn_session` | Start/end session tracking |
| `muninn` | Passthrough to full CLI (40+ commands) |

## Adaptive Intelligence

Muninn gets smarter in two dimensions:

**Per-codebase**: Tracks which files change together, fragility patterns, architectural drift, and recurring issues. After a few sessions, it predicts what you'll need to touch and warns about risks.

**Per-developer**: Builds a profile of your coding preferences — error handling style, naming conventions, patterns you favor. This follows you across projects.

**Closed feedback loops**: Every tool call is measured. Context that helps gets boosted. Context that's irrelevant gets suppressed. The system self-tunes.

## Multi-Machine Setup

Muninn supports a hub-and-spoke architecture using [sqld](https://github.com/tursodatabase/libsql/tree/main/libsql-server) for shared memory across machines:

```bash
# On your central server
docker run -d --name sqld -p 8080:8080 \
  -v sqld-data:/var/lib/sqld \
  ghcr.io/tursodatabase/libsql-server:latest

# On each machine
export MUNINN_MODE=http
export MUNINN_PRIMARY_URL=http://YOUR_SERVER:8080
claude mcp add --scope user muninn -- env MUNINN_MODE=http MUNINN_PRIMARY_URL=http://YOUR_SERVER:8080 muninn-mcp
```

## Optional: Enhanced Search

Muninn works fully offline. Optional APIs improve search quality:

| Feature | API Key | Fallback |
|---------|---------|----------|
| Vector search | `VOYAGE_API_KEY` | Local Transformers.js |
| Smart re-ranking | `ANTHROPIC_API_KEY` | Standard FTS |

## CLI Reference

```bash
muninn status                      # Project state
muninn query "auth"                # Search memory
muninn query "auth" --smart        # LLM-ranked search
muninn check src/auth.ts           # Pre-edit safety check
muninn impact src/types.ts         # Blast radius analysis
muninn fragile                     # List high-risk files
muninn drift                       # Knowledge staleness
muninn ship                        # Pre-deploy checklist
muninn deps src/index.ts           # Dependency graph
muninn deps --cycles               # Find circular deps
```

## Philosophy

1. **Query, don't preload** — Load context when needed, not upfront
2. **Safety first** — Know what's fragile before touching it
3. **Continuity** — Pick up where you left off, always
4. **Accumulate wisdom** — Every session makes the next one better
5. **Zero friction** — Auto-init, auto-session, auto-track

## Contributing

Issues and bug reports welcome. Feature requests: open an issue first.

## License

[AGPL-3.0-only](https://www.gnu.org/licenses/agpl-3.0.html) — free to use, modify, and share. If you run a modified version as a network service, you must release your source. Built by builders, for builders.

---

Built in collaboration with [Claude Code](https://claude.ai/code).
