# CLAUDE.md — Project Memory (Muninn)

This project uses [Muninn](https://github.com/ravnltd/muninn) for persistent memory across sessions.

---

## Available Tools

You have these MCP tools available:

### Core Tools
| Tool | Purpose |
|------|---------|
| `muninn_query` | Search project memory (decisions, issues, learnings, files) |
| `muninn_check` | **Pre-edit warnings** — ALWAYS use before editing files |
| `muninn_file_add` | Record file knowledge after modifying |
| `muninn_decision_add` | Record architectural decisions |
| `muninn_learn_add` | Save learnings for future sessions |
| `muninn_issue` | Add or resolve issues (action: add/resolve) |
| `muninn_session` | Start or end sessions (action: start/end) |
| `muninn_predict` | Bundle context for a task (FTS/keyword matching) |
| `muninn_suggest` | Suggest files for a task (semantic/embedding search) |

### Passthrough Tool
For other commands, use the `muninn` passthrough:
```
muninn "status"                    # Project state
muninn "fragile"                   # List fragile files
muninn "insights list"             # Cross-session insights
muninn "focus set --area auth"     # Boost related queries
```

---

## Before Editing Files (MANDATORY)

```
muninn_check [files...]  → Pre-edit warnings (fragility, issues, staleness)
```

If fragility >= 7, explain your approach and wait for approval.

---

## Search Strategy

| Situation | Use |
|-----------|-----|
| Know exact term | `muninn_query "term"` with fts: true |
| Conceptual search | `muninn_query "concept"` with vector: true |
| Find files for a task | `muninn_suggest "task description"` |
| Bundle all task context | `muninn_predict "task"` |

---

## After Making Changes

```
muninn_file_add          # Update file knowledge
muninn_decision_add      # Record significant choices
muninn_learn_add         # Save insights for future sessions
```

---

*Query before acting. Check before editing. Record what you learn.*
