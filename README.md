# Muninn

A semantic memory system for Claude Code. Persistent, queryable project knowledge across sessions via MCP tools and CLI.

## How It Works

Every Claude Code session automatically:
1. Loads context from the last session (via `SessionStart` hook)
2. Makes 20+ memory tools available as native MCP tools
3. Tracks file edits and session state (via `PostToolUse` and `Stop` hooks)

Projects are auto-initialized on first session — no manual setup required.

## Setup

```bash
# Install CLI (requires Bun)
cd /path/to/muninn
bun run build
cp muninn ~/.local/bin/

# Register MCP server with Claude Code (user scope = all projects)
claude mcp add --scope user --transport stdio muninn -- bun run /path/to/muninn/src/mcp-server.ts

# Verify
claude mcp list
```

### Hooks (Optional but Recommended)

Add to `~/.claude/settings.json` for automatic session management:

- **SessionStart**: Loads resume context, smart status, auto-inits `.context/` database
- **PreToolUse**: Checks file fragility before edits
- **PostToolUse**: Tracks edited files in memory
- **Stop**: Persists session state on exit

See `~/.claude/hooks/context-integration/` for the hook scripts.

## Architecture

### Database

Each project gets a `.context/` directory containing a SQLite database with:
- **Files**: Purpose, fragility scores, staleness detection
- **Decisions**: Architectural choices with reasoning
- **Issues**: Bugs and problems with workarounds
- **Sessions**: Work history with goals, outcomes, next steps
- **Learnings**: Patterns and gotchas (project-specific or global)
- **Symbols**: Function-level knowledge with signatures and side effects
- **Blast Radius**: Precomputed transitive dependency impact
- **Bookmarks**: Session-scoped working memory
- **Focus**: Current work area for query boosting
- **Infrastructure**: Servers, services, routes, deployments (global)

### Source Structure

```
src/
├── index.ts                    # CLI entry point and command router
├── mcp-server.ts               # MCP server (exposes tools to Claude)
├── types.ts                    # All interfaces and type definitions
├── analysis/
│   └── chunker.ts              # Semantic code chunking for function-level search
├── commands/
│   ├── analysis.ts             # Project analysis, Claude API integration
│   ├── blast.ts                # Blast radius computation
│   ├── bookmark.ts             # Working memory bookmarks
│   ├── chunk.ts                # Code chunking CLI
│   ├── deps.ts                 # File dependency graph (imports/dependents)
│   ├── embed.ts                # Vector embedding management
│   ├── focus.ts                # Work area focus
│   ├── git.ts                  # Git integration hooks
│   ├── hooks.ts                # Hook-optimized commands
│   ├── infra/                  # Infrastructure management (servers, services, routes)
│   ├── intelligence.ts         # Drift detection, smart status, conflict checks
│   ├── memory.ts               # File, decision, issue, learn CRUD
│   ├── query.ts                # Semantic search (FTS5 + vector)
│   ├── session.ts              # Session tracking with auto-learning
│   └── ship.ts                 # Pre-deploy checklist
├── database/
│   ├── connection.ts           # Singleton DB connection manager
│   ├── migrations.ts           # Schema migrations
│   ├── schema.ts               # Drizzle ORM schema
│   └── queries/
│       ├── infra.ts            # Infrastructure queries
│       ├── search.ts           # FTS5 search (parameterized)
│       └── vector.ts           # Vector similarity search
├── embeddings/
│   ├── index.ts                # Embedding orchestration
│   └── voyage.ts               # Voyage AI embeddings
└── utils/
    ├── api-keys.ts             # API key management
    ├── errors.ts               # Result types, error logging
    ├── format.ts               # Output formatting (CLI, JSON, Mermaid)
    └── validation.ts           # Zod schemas for CLI inputs
```

## MCP Tools

Once registered, Claude has these native tools:

### Status & Intelligence

| Tool | Purpose |
|------|---------|
| `muninn_status` | Basic project state |
| `muninn_smart_status` | Actionable status with recommendations |
| `muninn_fragile` | List files with high fragility scores |
| `muninn_resume` | Last session goal, outcome, next steps |
| `muninn_drift` | Detect stale knowledge and git changes |
| `muninn_check` | Pre-edit warnings (fragility, issues, staleness) |
| `muninn_impact` | Blast radius analysis for a file |
| `muninn_conflicts` | Check if files changed since last query |

### Search

| Tool | Purpose |
|------|---------|
| `muninn_query` | Hybrid search (FTS + vector) |
| `muninn_vector_search` | Pure semantic similarity search |

### Working Memory

| Tool | Purpose |
|------|---------|
| `muninn_bookmark_add` | Save context for later recall |
| `muninn_bookmark_get` | Retrieve bookmarked content |
| `muninn_bookmark_list` | List all bookmarks |
| `muninn_bookmark_delete` | Remove a bookmark |
| `muninn_bookmark_clear` | Clear all bookmarks |

### Focus

| Tool | Purpose |
|------|---------|
| `muninn_focus_set` | Set current work area (boosts related results) |
| `muninn_focus_get` | Show current focus |
| `muninn_focus_clear` | Clear focus |

### Memory Updates

| Tool | Purpose |
|------|---------|
| `muninn_file_add` | Record file purpose and fragility |
| `muninn_decision_add` | Record architectural decisions |
| `muninn_issue_add` | Track bugs and problems |
| `muninn_issue_resolve` | Mark issues as fixed |
| `muninn_learn_add` | Save learnings (project or global) |

### Session Management

| Tool | Purpose |
|------|---------|
| `muninn_session_start` | Start a work session with a goal |
| `muninn_session_end` | End session with outcome summary |

### Utilities

| Tool | Purpose |
|------|---------|
| `muninn_ship` | Pre-deploy checklist |
| `muninn_debt_add` | Track technical debt |
| `muninn_debt_list` | List all tech debt |
| `muninn_embed` | Manage vector embeddings |
| `muninn_deps` | Query file dependencies |

## CLI Reference

```bash
# Project
muninn init                        # Initialize .context/ for current project
muninn status                      # Full project state
muninn fragile                     # List fragile files

# Search
muninn query "authentication"      # FTS search
muninn query "auth" --vector       # Semantic similarity
muninn query "auth" --smart        # Claude re-ranked results

# Intelligence
muninn check src/auth.ts           # Pre-edit warnings
muninn impact src/types.ts         # Blast radius
muninn ss                          # Smart status
muninn drift                       # Knowledge staleness
muninn resume                      # Last session summary

# Dependencies
muninn deps src/index.ts           # Show imports/dependents
muninn deps --refresh              # Rebuild dependency graph
muninn deps --graph                # Mermaid diagram
muninn deps --cycles               # Find circular deps

# Memory
muninn file add src/auth.ts --fragility 8 --purpose "Auth system"
muninn decision add --title "Use Drizzle" --reasoning "Type-safe SQL"
muninn issue add --title "Bug" --severity 7
muninn issue resolve 1 "Fixed in commit abc123"
muninn learn add --title "Pattern" --content "Always validate at boundaries"

# Sessions
muninn session start "implementing auth"
muninn session end 42 --outcome "Auth complete" --success 2

# Embeddings
muninn embed status                # Coverage stats
muninn embed backfill              # Generate missing embeddings

# Deploy
muninn ship                        # Pre-deploy checklist
```

## Vector Search

Semantic search uses [Voyage AI](https://www.voyageai.com/) embeddings. Set `VOYAGE_API_KEY` to enable:

```bash
export VOYAGE_API_KEY=your-key

# Generate embeddings for existing knowledge
muninn embed backfill

# Search by meaning (not just keywords)
muninn query "how does error handling work" --vector
```

## Philosophy

1. **Query, don't preload** — Load context when needed, not upfront
2. **Safety** — Know what's fragile before touching it
3. **Continuity** — Pick up where you left off
4. **Learning** — Build project knowledge over time
5. **Minimal friction** — Auto-init, auto-session, auto-track

The goal: Claude operates like a senior engineer who's been on the project for years.

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) — free to use, modify, and share for any noncommercial purpose. Commercial use requires a separate license from the author.
