# Claude Context Engine

A semantic memory system for Claude Code. Instead of losing context between sessions, Claude stores and queries a structured database of project knowledge.

## MCP Integration (Recommended)

The context commands are available as **native Claude Code tools** via MCP. This means Claude won't "forget" to use them — they appear in Claude's tool list alongside Read, Write, etc.

### Setup

```bash
# Install the CLI
chmod +x install.sh
./install.sh

# Register MCP server with Claude Code (user scope = all projects)
claude mcp add --scope user --transport stdio claude-context -- bun run /path/to/claude-context/src/mcp-server.ts

# Verify it's connected
claude mcp list
```

### Available Tools

Once registered, Claude has these native tools:

| Tool | Purpose |
|------|---------|
| `context_status` | Get project state, fragile files, issues, decisions |
| `context_fragile` | List dangerous files |
| `context_query` | Search project memory |
| `context_file_add` | Record file knowledge |
| `context_decision_add` | Record architectural decisions |
| `context_issue_add` | Track issues |
| `context_issue_resolve` | Mark issues fixed |
| `context_learn_add` | Save learnings |
| `context_debt_add` | Track tech debt |
| `context_ship` | Pre-deploy checklist |

### Why MCP?

The original approach relied on CLAUDE.md telling Claude to run bash commands. Problem: Claude often forgot. MCP makes these first-class tools that Claude can't ignore.

## The Problem

- Claude forgets everything between sessions
- Markdown context files get long and unwieldy
- Claude can't query for specific information
- You repeat yourself constantly
- Claude breaks things it should remember are fragile

## The Solution

A SQLite database that Claude can:
- **Query semantically** — "what do I know about authentication?"
- **Store structured knowledge** — files, decisions, issues, learnings
- **Track relationships** — what depends on what, what affects what
- **Remember fragility** — which files need careful handling
- **Maintain session continuity** — what we did, what's next

## Quick Start

```bash
# Install (requires Bun)
chmod +x install.sh
./install.sh

# In any project
cd ~/projects/myapp
context init
context status
```

## Architecture

### Codebase Structure (v2)

```
src/
├── index.ts                 # CLI entry point and command router
├── types.ts                 # All interfaces and type definitions
├── database/
│   ├── connection.ts        # Singleton DB connection manager
│   └── queries/
│       ├── infra.ts         # Infrastructure queries (N+1 optimized)
│       └── search.ts        # FTS5 semantic search (parameterized)
├── commands/
│   ├── infra/               # server, service, route, status
│   ├── analysis.ts          # Project analysis, Claude API integration
│   ├── memory.ts            # file, decision, issue, learn, pattern, debt
│   ├── query.ts             # Semantic search with optional re-ranking
│   ├── session.ts           # Session tracking
│   └── ship.ts              # Pre-deploy checklist
└── utils/
    ├── errors.ts            # Result types, error logging
    ├── format.ts            # Output formatting (CLI, JSON, Mermaid)
    └── validation.ts        # Zod schemas for CLI inputs
```

### Database Layout

```
~/.claude/
├── CLAUDE.md           # Global behavior rules (tells Claude to use memory)
├── memory.db           # Global database (infrastructure, patterns, cross-project learnings)
└── schema.sql          # Database schema

~/projects/myapp/
└── .claude/
    └── memory.db       # Project-specific memory
```

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `projects` | Projects Claude has worked on |
| `files` | File knowledge: purpose, fragility, dependencies |
| `symbols` | Functions/components: signatures, side effects, callers |
| `decisions` | Architectural decisions: what, why, affects |
| `issues` | Known problems: severity, workarounds, resolutions |
| `sessions` | Work sessions: goal, outcome, files touched |
| `learnings` | Patterns and gotchas: global or project-specific |
| `relationships` | Connections between entities |

### Key Features

- **Full-text search** via SQLite FTS5
- **Vector embeddings** (BLOB field ready for semantic search upgrade)
- **Fragility tracking** (0-10 scale per file)
- **Session continuity** (last session's next_steps → this session's context)

## CLI Reference

### Project Management

```bash
context init                    # Initialize context for current project
context status                  # Full project state summary
context fragile                 # List fragile files/areas
context recent [n]              # Recent activity
```

### Semantic Query

```bash
context query "authentication"  # Search all context
context query "database issues" # Find related issues
context query "why postgres"    # Find decisions
```

### File Knowledge

```bash
# Add/update file knowledge
context file add src/lib/auth.ts \
  --type util \
  --purpose "User authentication and sessions" \
  --fragility 8 \
  --fragility-reason "Core security, many dependents"

# Get file details
context file get src/lib/auth.ts

# List files
context file list              # All files
context file list fragile      # Fragile files
context file list util         # By type
```

### Decisions

```bash
# Record a decision
context decision add \
  --title "Use Drizzle over Prisma" \
  --decision "Drizzle ORM for database access" \
  --reasoning "SQL-like syntax, better types, lighter weight" \
  --affects '["src/db/*", "src/lib/queries/*"]'

# List active decisions
context decision list
```

### Issues

```bash
# Record an issue
context issue add \
  --title "Login fails on Safari" \
  --description "Cookie SameSite issue" \
  --severity 7 \
  --type bug \
  --files '["src/lib/auth.ts"]' \
  --workaround "Use Chrome"

# Mark resolved
context issue resolve 1 "Fixed SameSite=None with Secure flag"

# List issues
context issue list             # Open issues
context issue list resolved    # Resolved issues
```

### Learnings

```bash
# Project-specific learning
context learn add \
  --category gotcha \
  --title "Middleware order matters" \
  --content "Session middleware must run before auth middleware" \
  --context "Express/Hono request handling"

# Global learning (applies to all projects)
context learn add --global \
  --category pattern \
  --title "Zod schemas as single source of truth" \
  --content "Define Zod schema first, derive types and validation"

# List learnings
context learn list
```

### Sessions

```bash
# Start a work session
context session start "implementing password reset"

# End with summary
context session end 42 \
  --outcome "Password reset flow complete, email sending works" \
  --files '["src/lib/auth.ts", "src/routes/reset/*"]' \
  --learnings "Resend API requires verified domain" \
  --next "Add rate limiting to reset endpoint" \
  --success 2

# Check last session (for continuity)
context session last
```

## How Claude Uses This

The `CLAUDE.md` file instructs Claude to:

### Session Start
1. `context status` — Get current state
2. `context session last` — See what we were doing
3. `context fragile` — Know what's sensitive
4. `context session start "goal"` — Track this session

### Before Any Change
1. `context query "<topic>"` — Check existing knowledge
2. `context file get <path>` — Check file fragility/purpose
3. State scope lock explicitly

### After Any Change
1. `context file add` — Update file knowledge
2. `context decision add` — Record decisions made
3. `context issue add` — Record issues found
4. `context learn add` — Record insights

### Session End
1. `context session end` — Record outcome and next steps

## Upgrading to Vector Search

The schema includes `embedding BLOB` fields for future vector search. To enable semantic search:

1. Install a local embedding model (e.g., via Ollama)
2. Modify `src/database/queries/search.ts` to generate embeddings on insert
3. Use cosine similarity for semantic queries

```typescript
// Future: semantic query with embeddings
const embedding = await embed(query);
const results = db.query(`
  SELECT *, cosine_similarity(embedding, ?) as score
  FROM files
  ORDER BY score DESC
  LIMIT 10
`).all(embedding);
```

## Tips

### Keep Memory Focused
- Don't store obvious things
- Focus on decisions, gotchas, fragility
- Update when knowledge changes

### Trust Your Memory
- If memory says fragile, be careful
- If memory says "do not touch", don't
- Check memory before making changes

### Clean Up Occasionally
```sql
-- Remove old resolved issues
DELETE FROM issues WHERE status = 'resolved' AND resolved_at < date('now', '-30 days');

-- Archive old sessions
DELETE FROM sessions WHERE ended_at < date('now', '-90 days');
```

### Per-Project vs Global
- **Project**: Specific decisions, files, issues
- **Global**: Patterns, preferences, cross-project learnings

## Philosophy

This isn't about making Claude remember everything. It's about:

1. **Surgical precision** — Query for exactly what's relevant
2. **Safety** — Know what's fragile before touching it
3. **Continuity** — Pick up where you left off
4. **Learning** — Build up project knowledge over time
5. **Efficiency** — One-pass task completion with full context

The goal: Claude operates like a senior engineer who's been on the project for years, not a contractor seeing it for the first time every session.

---

*"Give me six hours to chop down a tree and I will spend the first four sharpening the axe." — Now the axe stays sharp.*
