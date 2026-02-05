# CLAUDE.md — Muninn Memory System

You have **native MCP tools** for project memory. Query, don't preload.

---

## Multi-Machine Setup (Hub-and-Spoke)

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    HUB (sqld server)                    │
│  Docker: ghcr.io/tursodatabase/libsql-server:latest     │
│  Port: 8080 (HTTP API)                                  │
│  Data: /var/lib/docker/volumes/muninn-sqld-data         │
└─────────────────────────────────────────────────────────┘
                           │
              HTTP API (YOUR_SQLD_HOST:8080)
                           │
     ┌─────────────────────┼─────────────────────┐
     ▼                     ▼                     ▼
┌─────────┐          ┌─────────┐          ┌─────────┐
│ Spoke 1 │          │ Spoke 2 │          │  Hub    │
│ http    │          │ http    │          │ http    │
│ mode    │          │ mode    │          │ mode    │
└─────────┘          └─────────┘          └─────────┘
```

**Mode selection:**
| Mode | Local State | Use Case |
|------|-------------|----------|
| `http` | **None** | Multi-machine (recommended) |
| `local` | Full DB | Single machine only |

**sqld server:** `http://YOUR_SQLD_HOST:8080` (Tailscale)

### Install Claude Code first

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Gotchas:**
- Never use `sudo` with claude install - installs to root's home
- Must use `bash`, not `sh` - script uses bash syntax

### Install muninn with HTTP mode

```bash
git clone https://github.com/ravnltd/original-muninn.git ~/.local/share/muninn && \
cd ~/.local/share/muninn && \
./install.sh && \
cat >> ~/.bashrc << 'EOF'
export PATH="$HOME/.local/bin:$PATH"
export MUNINN_MODE=http
export MUNINN_PRIMARY_URL=http://YOUR_SQLD_HOST:8080
EOF
source ~/.bashrc && \
claude mcp add --scope user muninn -- env MUNINN_MODE=http MUNINN_PRIMARY_URL=http://YOUR_SQLD_HOST:8080 muninn-mcp
```

### Database Backups (Hub only)

Daily backups run via cron at 3:00 AM:
```bash
# View backup status
ls -la ~/.claude/backups/

# Restore from backup (if needed)
docker stop muninn-sqld
cp ~/.claude/backups/sqld-YYYYMMDD.db /path/to/sqld/data/iku.db
docker start muninn-sqld
```

### Why HTTP Mode

HTTP mode is recommended for multi-machine setups:
- **Stateless**: No local database files - all queries go directly to sqld
- **No corruption risk**: No local WAL or replica to corrupt
- **Simple recovery**: Just reconnect - no data loss possible

---

## Core Principle: Lazy Loading

Treat context like RAM, not disk. Load what's needed, when needed.

```
WRONG: Load everything at session start
RIGHT: Query for specific context before each change
```

---

## Session Start Protocol (MANDATORY)

When the session starts, you'll see a **REQUIRED ACTIONS** section if there are pending items.
**Address these BEFORE starting the user's task:**

### 1. Decisions Due for Review
When you see decisions needing outcome review:
- Ask the user: "Did [decision title] work out? (succeeded/failed/revised)"
- Record their response: `muninn "outcome record <id> succeeded|failed|revised [notes]"`

### 2. New Insights
When you see pending insights:
- Review each insight briefly
- Acknowledge: `muninn "insights ack <id>"` (if relevant)
- Or dismiss: `muninn "insights dismiss <id>"` (if not useful)

**Insights auto-dismiss after being shown 5 times without action.**

---

## Session Lifecycle

### Session Start (Automatic)
Session startup is handled by the SessionStart hook. It automatically:
- Outputs resume context (last session goal, outcome, next steps)
- Shows REQUIRED ACTIONS (decisions due, new insights)
- Outputs smart status (health, actions, warnings)
- Starts a new session via CLI

**Do NOT call** `muninn_resume`, `muninn_smart_status`, or `muninn_session` at startup.
They are already provided in your initial context.

### Before Editing Files (MANDATORY)
```
muninn_check [files...]  → Pre-edit warnings (fragility, issues, staleness)
```
If fragility >= 7, explain your approach and wait for approval.

### During Work
```
muninn_query "topic"     → Search for relevant context
muninn "focus set --area X" → Set focus to boost related results
muninn "bookmark add --label x --content y" → Save important snippets
```

### After Changes
```
muninn_file_add          → Update file knowledge
muninn_decision_add      → Record significant choices
muninn_learn_add         → Save insights for future sessions
```

---

## Tools (Optimized)

### 9 Core Tools (Full Schemas)
| Tool | Purpose |
|------|---------|
| `muninn_query` | Search project memory (FTS/vector/smart) |
| `muninn_check` | **Pre-edit warnings** — ALWAYS use before editing |
| `muninn_file_add` | Record file knowledge after modifying |
| `muninn_decision_add` | Record architectural decisions |
| `muninn_learn_add` | Save learnings for future sessions |
| `muninn_issue` | Add or resolve issues (action: add/resolve) |
| `muninn_session` | Start or end sessions (action: start/end) |
| `muninn_predict` | Bundle context for a task (FTS/keyword matching) |
| `muninn_suggest` | Suggest files for a task (semantic/embedding search) |

### Text Validation Rules

All text inputs are validated to prevent shell injection. **Blocked characters:**
```
`  $  (  )  {  }  |  ;  &  <  >  \
```

When using `muninn_decision_add`, `muninn_learn_add`, or `muninn_issue`:
- **No backticks** - describe code in plain words
- **No variable syntax** - avoid $HOME, ${var}, $(cmd)
- **No shell operators** - no pipes, semicolons, ampersands
- **No redirects** - no < or >

**Examples:**
```
BAD:  "Use `http` mode"           # backticks
BAD:  "Check $HOME/.config"       # dollar sign
BAD:  "Run cmd1 | cmd2"           # pipe
BAD:  "If (condition) { do }"     # parens and braces
GOOD: "Use http mode"
GOOD: "Check the home config dir"
GOOD: "Pipe the output to cmd2"
```

### Passthrough Tool
For everything else, use the `muninn` passthrough:

```
muninn "status"                    → Project state
muninn "fragile"                   → List fragile files
muninn "outcome record 5 succeeded" → Record decision outcome
muninn "insights list"             → View insights
muninn "insights ack 3"            → Acknowledge insight
muninn "bookmark add --label x --content y"
muninn "focus set --area auth"
muninn "observe 'pattern noticed'"
muninn "debt add --title X --severity 5 --effort medium"
```

---

## Quick Reference

### Search Strategy
| Situation | Use |
|-----------|-----|
| Know exact term | `muninn_query "term"` with fts: true |
| Conceptual search | `muninn_query "concept"` with vector: true |
| Need best results | `muninn_query "topic"` with smart: true |
| Find related files for task | `muninn_suggest "task description"` |
| Bundle all task context | `muninn_predict "task"` (FTS) + files list |

### When to Use What
| Scenario | Tool |
|----------|------|
| Session start | Automatic (hook provides everything) |
| REQUIRED ACTIONS shown | Address decisions/insights FIRST |
| About to edit a file | `muninn_check` (MANDATORY) |
| Need specific context | `muninn_query` |
| Find files for a task | `muninn_suggest` (semantic) or `muninn_predict` (FTS) |
| Made a decision | `muninn_decision_add` |
| Modified a file | `muninn_file_add` |
| Learned something | `muninn_learn_add` |

---

## Red Flags — Stop and Ask

- File with fragility >= 7
- Changing > 3 files for a "simple" task
- Adding new dependencies
- Changing API contracts
- Scope creeping ("while I'm here...")

When triggered:
> "This is expanding scope. Original task was X. Should I: A) Minimal fix only, B) Do it properly, C) Note for later?"

---

## Quality Standards

- **No `any` type** without justification
- **Max 30 lines** per function
- **Single responsibility** per file
- **Early returns** for edge cases
- **Zod validation** at boundaries

---

*Query, don't preload. Address REQUIRED ACTIONS first. The tools are in your tool list.*

<!-- MUNINN:START -->
## Muninn Memory Tools

This project uses [Muninn](https://github.com/ravnltd/muninn) for persistent memory.

### Before Editing Files
```
muninn_check [files...]  → Pre-edit warnings (fragility, issues, staleness)
```

### Core Tools
| Tool | Purpose |
|------|---------|
| `muninn_query` | Search project memory |
| `muninn_check` | Pre-edit warnings (MANDATORY) |
| `muninn_suggest` | Semantic file suggestions |
| `muninn_predict` | FTS-based context bundle |
| `muninn_file_add` | Record file knowledge |
| `muninn_decision_add` | Record decisions |
| `muninn_learn_add` | Save learnings |

### After Changes
```
muninn_file_add          # Update file knowledge
muninn_decision_add      # Record significant choices
muninn_learn_add         # Save insights
```

*Run `muninn --help` for full CLI reference.*
<!-- MUNINN:END -->
