# Muninn

[![npm](https://img.shields.io/npm/v/muninn-ai?color=blue)](https://www.npmjs.com/package/muninn-ai)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![GitHub stars](https://img.shields.io/github/stars/ravnltd/muninn)](https://github.com/ravnltd/muninn)

**Your AI coding agent forgets everything between sessions. Muninn fixes that.**

```bash
npx muninn-ai
```

Muninn gives AI coding agents persistent memory. Before every edit, the agent knows what's fragile, what decisions were made, and what broke last time. After every session, it writes back what it learned. Session 50 has the same institutional knowledge as session 1.

Every session builds on the last. Every project informs every other project. Patterns learned in one codebase show up as warnings in another. Decisions compound. Solo builders can build like teams.

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

### Context Budget

Most memory tools dump everything into the context window. Muninn doesn't. It enforces a hard **2000-token budget** per tool call. Seven intelligence signals run in parallel (~5-15ms), determine what's actually relevant to what you're doing right now, and pack only that into context. It tracks which context the agent actually used vs ignored, and adjusts the budget allocation over time. Irrelevant stuff gets suppressed. Useful stuff gets more room.

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

The installer creates wrapper scripts in `~/.local/bin/`, sets up hooks, and registers the MCP server.

### Register with Your Editor

```bash
# Claude Code
claude mcp add --scope user muninn -- muninn-mcp

# Other MCP clients: point to the muninn-mcp script in ~/.local/bin/
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

14 tools available to your AI agent via [Model Context Protocol](https://modelcontextprotocol.io/):

### Core Tools

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

### Intelligence Tools

| Tool | What It Does |
|------|--------------|
| `muninn_enrich` | Auto-inject context for Read/Edit/Write/Bash/Glob/Grep calls |
| `muninn_approve` | Approve blocked operations on high-fragility files |
| `muninn_context` | Unified context retrieval with intent routing (edit/read/debug/explore/plan) |
| `muninn_intent` | Multi-agent coordination (declare/query/release file locks) |

### Passthrough

| Tool | What It Does |
|------|--------------|
| `muninn` | Passthrough to full CLI (50+ commands) |

## Adaptive Intelligence

Muninn gets smarter in two dimensions:

**Per-codebase**: Tracks which files change together, fragility patterns, architectural drift, and recurring issues. After a few sessions, it predicts what you'll need to touch and warns about risks.

**Per-developer**: Builds a profile of your coding preferences — error handling style, naming conventions, patterns you favor. This follows you across projects.

### Feedback Loops

Seven feedback loops run in parallel on every tool call:

1. **Strategy success rates** — what approaches worked before
2. **Workflow prediction** — anticipates next tool call
3. **Staleness detection** — reduces budget for outdated knowledge
4. **Impact tracking** — measures what context actually helped vs was ignored
5. **Budget optimization** — A/B tests different context allocations
6. **Agent profiling** — detects scope creep and repeated failure patterns
7. **Trajectory analysis** — adjusts context based on whether you're exploring, failing, stuck, or confident

All feeding into the 2000-token budget. Context that helps gets boosted. Context that's irrelevant gets suppressed.

### Fragility Scoring

Not a guess — a weighted composite of 7 signals:

| Signal | Weight | What It Measures |
|--------|--------|-----------------|
| Dependents | 25% | How many files import this one |
| Test coverage | 20% | Whether tests exist for this file |
| Change velocity | 15% | How often it changes per week |
| Error history | 15% | How many errors in the last 90 days |
| Export surface | 10% | How many things it exports |
| Complexity | 10% | Symbol count and structural complexity |
| Manual override | 5% | Human-specified bias |

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

Two modes:

| Mode | Local State | Use Case |
|------|-------------|----------|
| `local` | Full DB | Single machine |
| `http` | None (stateless) | Multi-machine (recommended) |

HTTP mode is stateless — all queries go directly to sqld. No local replica to corrupt. Just reconnect if anything goes wrong.

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
