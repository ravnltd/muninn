# Muninn

A semantic memory system for AI-assisted development. Persistent, queryable project knowledge across sessions via MCP tools and CLI.

## How It Works

Every session automatically:
1. Loads context from the last session (via `SessionStart` hook)
2. Makes 10 MCP tools available (9 core + 1 passthrough for full CLI access)
3. Tracks file edits and session state (via `PostToolUse` and `Stop` hooks)

Projects are auto-initialized on first session — no manual setup required.

## Setup

```bash
# Install Bun (if needed)
curl -fsSL https://bun.sh/install | bash

# Clone and build
git clone https://github.com/ravnltd/muninn.git
cd muninn
bun run build

# Install globally
cp muninn ~/.local/bin/

# Register MCP server (user scope = all projects)
claude mcp add --scope user muninn -- bunx muninn-mcp

# Verify
claude mcp list
```

### Hooks (Optional but Recommended)

Add to `~/.claude/settings.json` for automatic session management:

- **SessionStart**: Loads resume context, smart status, auto-inits `.claude/` database
- **PreToolUse**: Checks file fragility before edits
- **PostToolUse**: Tracks edited files in memory
- **Stop**: Persists session state on exit

See `~/.claude/hooks/` for the hook scripts.

## Architecture

### Database

Each project gets a `.claude/` directory containing a SQLite database with:
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
├── mcp-server.ts               # MCP server (10 tools: 9 core + 1 passthrough)
├── types.ts                    # All interfaces and type definitions
├── commands/                   # All CLI commands
├── database/                   # SQLite connection, migrations, queries
├── embeddings/                 # Vector embedding providers
└── utils/                      # Validation, errors, formatting
```

## MCP Tools

Once registered, these tools are available:

### Core Tools (Full Schemas)

| Tool | Purpose |
|------|---------|
| `muninn_query` | Search project memory (FTS/vector/smart) |
| `muninn_check` | Pre-edit warnings (fragility, issues, staleness) |
| `muninn_file_add` | Record file knowledge after modifying |
| `muninn_decision_add` | Record architectural decisions |
| `muninn_learn_add` | Save learnings for future sessions |
| `muninn_issue` | Add or resolve issues (action: add/resolve) |
| `muninn_session` | Start or end sessions (action: start/end) |
| `muninn_predict` | Bundle all context for a task (FTS/keyword matching) |
| `muninn_suggest` | Suggest files for a task (semantic/embedding search) |

### Passthrough Tool

For all other commands, use the `muninn` passthrough:

```
muninn "status"                     # Project state
muninn "fragile"                    # List fragile files
muninn "outcome record 5 succeeded" # Record decision outcome
muninn "insights list"              # View cross-session insights
muninn "insights ack 3"             # Acknowledge insight
muninn "bookmark add --label x --content y"
muninn "focus set --area auth"
muninn "debt add --title X --severity 5"
muninn "deps src/index.ts"          # Show file dependencies
muninn "impact src/types.ts"        # Blast radius analysis
```

This hybrid approach provides full CLI access while keeping context overhead minimal.

## CLI Reference

```bash
# Project
muninn init                        # Initialize .claude/ for current project
muninn status                      # Full project state
muninn fragile                     # List fragile files

# Search
muninn query "authentication"      # FTS search
muninn query "auth" --vector       # Semantic similarity
muninn query "auth" --smart        # LLM re-ranked results

# Intelligence
muninn check src/auth.ts           # Pre-edit warnings
muninn impact src/types.ts         # Blast radius
muninn ss                          # Smart status
muninn drift                       # Knowledge staleness
muninn resume                      # Last session summary
muninn predict "fix auth bug"      # FTS-based context bundle
muninn suggest "fix auth bug"      # Semantic file suggestions

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

Semantic search is always available via local [Transformers.js](https://huggingface.co/docs/transformers.js) embeddings (384 dimensions, offline). For higher quality, set a Voyage AI key:

```bash
# Optional: use Voyage AI for better embeddings (512 dimensions)
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

The goal: your AI assistant operates like a senior engineer who's been on the project for years.

## Contributing

Issues and bug reports welcome.
Feature requests: open an issue first.
PRs: not accepting at this time.

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) — free to use, modify, and share for any noncommercial purpose. Commercial use requires a separate license from [Ravn Ltd](https://råven.com).

---

Built with [Claude Code](https://claude.ai/code).
