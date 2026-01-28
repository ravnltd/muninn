# Muninn

[![CI](https://github.com/ravnltd/muninn/actions/workflows/ci.yml/badge.svg)](https://github.com/ravnltd/muninn/actions/workflows/ci.yml)

A semantic memory system for AI-assisted development. Persistent, queryable project knowledge across sessions via MCP tools and CLI.

**The more you use it, the smarter it gets** — Muninn learns your codebase patterns, tracks which files change together, remembers what worked (and what didn't), and adapts to your individual coding preferences over time.

## How It Works

Every session automatically:
1. Loads context from the last session (via `SessionStart` hook)
2. Makes 10 MCP tools available (9 core + 1 passthrough for full CLI access)
3. Tracks file edits and session state (via `PostToolUse` and `Stop` hooks)

Projects are auto-initialized on first session — no manual setup required.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)
- [Claude Code](https://claude.ai/code) CLI
- Git

### Step 1: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### Step 2: Clone and Build

```bash
git clone https://github.com/ravnltd/muninn.git
cd muninn
bun install
bun run build
bun run build:mcp
```

### Step 3: Install Globally

**Option A: Using the install script (recommended)**
```bash
./install.sh
```

**Option B: Manual install**
```bash
mkdir -p ~/.local/bin
cp muninn muninn-mcp ~/.local/bin/

# Add to PATH if not already (add to ~/.bashrc or ~/.zshrc)
export PATH="$HOME/.local/bin:$PATH"
```

### Step 4: Register MCP Server

```bash
# Register for all projects (user scope)
claude mcp add --scope user muninn -- muninn-mcp

# Verify registration
claude mcp list
```

### Step 5: Set Up Hooks (Recommended)

Hooks enable automatic session management. Copy the example hooks:

```bash
# Create hooks directory
mkdir -p ~/.claude/hooks

# Copy hook scripts
cp docs/hooks/*.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/*.sh
```

Then add hooks to `~/.claude/settings.json`. You can either:
- Copy the example: `cp docs/hooks/settings.example.json ~/.claude/settings.json`
- Or merge into your existing settings (see `docs/hooks/settings.example.json`)

**What the hooks do:**
- **SessionStart**: Loads resume context, shows smart status, auto-inits database
- **PreToolUse**: Checks file fragility before edits (warns on risky files)
- **PostToolUse**: Tracks edited files in session memory
- **Stop**: Persists session state on exit

### Step 6: Verify Installation

```bash
# Check CLI works
muninn --help

# Check MCP server is registered
claude mcp list | grep muninn

# Start Claude Code in any project
cd /path/to/your/project
claude

# You should see "Session Resume" output if hooks are working
```

## External API Connections (Optional)

Muninn works fully offline, but optional API integrations enhance capabilities:

### Voyage AI (Better Embeddings)

Voyage AI provides higher quality embeddings (512 dimensions) for semantic search. Without it, Muninn uses local Transformers.js embeddings (384 dimensions).

```bash
# Get API key from https://www.voyageai.com/
export VOYAGE_API_KEY=pa-your-key-here

# Add to your shell profile (~/.bashrc or ~/.zshrc) to persist
echo 'export VOYAGE_API_KEY=pa-your-key-here' >> ~/.bashrc

# Generate embeddings for existing knowledge
muninn embed backfill

# Verify
muninn embed status
```

### Anthropic API (Smart Re-ranking)

The Anthropic API enables LLM-powered re-ranking for search results (the `--smart` flag).

```bash
# Get API key from https://console.anthropic.com/
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# Add to your shell profile
echo 'export ANTHROPIC_API_KEY=sk-ant-your-key-here' >> ~/.bashrc

# Use smart search
muninn query "authentication flow" --smart
```

### API Key Summary

| Feature | API Key | Required? | Fallback |
|---------|---------|-----------|----------|
| Vector search | `VOYAGE_API_KEY` | No | Local Transformers.js |
| Smart re-ranking | `ANTHROPIC_API_KEY` | No | Standard FTS results |

## First Project Walkthrough

Once installed, here's how to use Muninn with a project:

```bash
# Navigate to your project
cd /path/to/your/project

# Start Claude Code
claude

# Muninn auto-initializes on first session
# You'll see the .claude/ directory created with memory.db

# During the session, Claude can use muninn tools:
# - muninn_query "search term" to find relevant context
# - muninn_check to verify file safety before edits
# - muninn_decision_add to record architectural choices
# - muninn_learn_add to save patterns for future sessions

# When you end the session, Muninn saves the state
# Next session picks up where you left off
```

### Common First Commands

```bash
# Check project status
muninn status

# See what files are known
muninn file list

# Search for context
muninn query "authentication"

# Check file safety before editing
muninn check src/important-file.ts
```

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

## Troubleshooting

### "muninn: command not found"

Ensure `~/.local/bin` is in your PATH:
```bash
export PATH="$HOME/.local/bin:$PATH"
# Add this line to ~/.bashrc or ~/.zshrc
```

### MCP server not appearing in Claude Code

1. Check registration: `claude mcp list`
2. Re-register: `claude mcp remove muninn && claude mcp add --scope user muninn -- muninn-mcp`
3. Restart Claude Code

### Hooks not running

1. Verify scripts are executable: `ls -la ~/.claude/hooks/`
2. Check settings.json syntax: `cat ~/.claude/settings.json | jq .`
3. Test hook manually: `~/.claude/hooks/session-start.sh`

### "No project found" errors

Muninn auto-initializes, but you can manually init:
```bash
cd /path/to/your/project
muninn init
```

### Embeddings not working

Check API key status:
```bash
muninn embed status
# Shows which embedding provider is active
```

## Philosophy

1. **Query, don't preload** — Load context when needed, not upfront
2. **Safety** — Know what's fragile before touching it
3. **Continuity** — Pick up where you left off
4. **Learning** — Build project knowledge over time
5. **Minimal friction** — Auto-init, auto-session, auto-track

The goal: your AI assistant operates like a senior engineer who's been on the project for years.

## Adaptive Intelligence

Muninn gets smarter in two dimensions:

**Per-codebase**: Tracks file correlations (which files change together), fragility patterns, architectural decisions, and recurring issues. After a few sessions, it knows your project's hot spots and can predict what files you'll need to touch.

**Per-developer**: Builds a profile of your coding preferences — error handling style, naming conventions, patterns you favor, anti-patterns you avoid. This profile follows you across projects (stored in `~/.claude/`).

## Compatibility

Muninn uses the [Model Context Protocol](https://modelcontextprotocol.io/), so the MCP server should work with any compatible tool:

- Claude Desktop
- Cursor
- Windsurf
- Continue.dev
- Any future MCP client

**Note:** Muninn has only been tested with Claude Code. The MCP tools will work elsewhere, but hooks (auto-session management, transcript analysis) are Claude Code specific. In other tools, you'll need to manually call `muninn session start/end`.

## Contributing

Issues and bug reports welcome.
Feature requests: open an issue first.
PRs: not accepting at this time.

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) — free to use, modify, and share for any noncommercial purpose. Commercial use requires a separate license from [Ravn Ltd](https://råven.com).

---

Built in collaboration with [Claude Code](https://claude.ai/code).
