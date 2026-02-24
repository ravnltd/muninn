# Muninn

[![CI](https://github.com/ravnltd/original-muninn/actions/workflows/ci.yml/badge.svg)](https://github.com/ravnltd/original-muninn/actions/workflows/ci.yml)

Universal persistent memory for AI coding agents.

AI agents have no memory between sessions and no awareness of what's dangerous. They'll happily refactor a critical file, contradict a decision made last week, or re-introduce a bug that was already fixed — because they don't know any better.

Muninn fixes this by giving the agent institutional knowledge. Before touching any file, the agent checks: how fragile is this? what decisions were made here? are there open issues? what files usually change together? If something is high-risk, the agent stops and explains its approach instead of plowing ahead. If a pattern was learned from a past mistake, it surfaces automatically so the same mistake doesn't happen twice.

There's a subtler problem too. As a codebase grows across dozens of AI sessions, each session makes locally reasonable decisions that drift from the original vision. Session 15 picks a different pattern than session 3. Two parts of the codebase solve the same problem differently. Nobody remembers *why* something was done a certain way, so the next session reinvents it. Muninn records every significant decision with its reasoning, so when the agent is about to make a choice, past decisions surface automatically. The agent can still diverge, but it does so knowingly, not accidentally. Patterns and conventions accumulate across sessions, so session 50 has access to the same architectural intent as session 1.

Unlike a typical RAG system that just retrieves documents, Muninn is a read-write memory loop: the AI queries context before making changes, then writes back what it learned — turning a stateless, amnesiac coding agent into one that accumulates project wisdom over time.

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

### Step 2: Clone and Install

```bash
# Clone to a permanent location
git clone https://github.com/ravnltd/original-muninn.git ~/.local/share/muninn
cd ~/.local/share/muninn

# Install (compiles binaries to ~/.local/bin/)
./install.sh
```

The install script:
- Compiles `muninn` and `muninn-mcp` binaries to `~/.local/bin/`
- Checks if `~/.local/bin` is in your PATH
- Shows MCP registration instructions

### Step 3: Add to PATH (if needed)

If the installer shows a PATH warning:

```bash
# Add to your shell profile (~/.bashrc or ~/.zshrc)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

# Reload shell
source ~/.bashrc  # or restart your terminal
```

### Step 4: Register MCP Server

```bash
# Register for all projects (user scope)
claude mcp add --scope user muninn -- muninn-mcp

# Verify registration
claude mcp list
```

**Note:** The MCP server uses compiled binaries, not source files. This ensures it works regardless of which directory Claude Code is started from.

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

## Multi-Machine Setup (Network/HTTP Mode)

Muninn can sync across multiple machines using a central sqld database server. This is useful for:
- Shared memory across workstations
- Remote development servers
- Keeping context in sync across your fleet

### Prerequisites

You need a [sqld](https://github.com/tursodatabase/libsql/tree/main/libsql-server) server running. Example with Docker:

```bash
# On your central server (e.g., YOUR_SQLD_HOST)
docker run -d --name sqld \
  -p 8080:8080 \
  -v sqld-data:/var/lib/sqld \
  ghcr.io/tursodatabase/libsql-server:latest
```

### Mode Options

| Mode | Native Modules | Local Replica | Offline | Best For |
|------|---------------|---------------|---------|----------|
| `local` | No | N/A (single file) | Yes | Single machine |
| `http` | No | No | No | **Compiled binaries, remote servers** |
| `network` | Yes (@libsql) | Yes | Yes | Dev machines with full toolchain |

**Use `http` mode for remote servers** — it uses pure HTTP fetch with no native C++ modules, so compiled binaries work anywhere.

### Quick Setup (Remote Server)

```bash
# 1. Clone and install
git clone https://github.com/ravnltd/original-muninn.git ~/.local/share/muninn
cd ~/.local/share/muninn
./install.sh

# 2. Add to PATH and set HTTP mode
cat >> ~/.bashrc << 'EOF'
export PATH="$HOME/.local/bin:$PATH"
export MUNINN_MODE=http
export MUNINN_PRIMARY_URL=http://YOUR_SQLD_SERVER:8080
EOF
source ~/.bashrc

# 3. Verify CLI works
muninn status

# 4. Register MCP with env vars
claude mcp add --scope user muninn -- env MUNINN_MODE=http MUNINN_PRIMARY_URL=http://YOUR_SQLD_SERVER:8080 muninn-mcp

# 5. Test MCP
claude mcp list  # Should show muninn as "Connected"
```

### Troubleshooting Network Mode

**"Cannot find module '@libsql/linux-x64-gnu'"**

You're using `network` mode on a compiled binary. Switch to `http` mode:
```bash
export MUNINN_MODE=http
```

**MCP shows connected but commands fail**

The MCP server needs env vars passed at registration:
```bash
claude mcp remove muninn
claude mcp add --scope user muninn -- env MUNINN_MODE=http MUNINN_PRIMARY_URL=http://SERVER:8080 muninn-mcp
```

**CLI works but Claude hangs**

Hooks call `muninn` directly. Export env vars in your shell profile:
```bash
echo 'export MUNINN_MODE=http' >> ~/.bashrc
echo 'export MUNINN_PRIMARY_URL=http://SERVER:8080' >> ~/.bashrc
source ~/.bashrc
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
