# CLAUDE.md — Muninn Memory System

You have **native MCP tools** for project memory. Query, don't preload.

---

## Core Principle: Lazy Loading

Treat context like RAM, not disk. Load what's needed, when needed.

```
WRONG: Load everything at session start
RIGHT: Query for specific context before each change
```

---

## Session Lifecycle

### Session Start (Automatic)
Session startup is handled by the SessionStart hook. It automatically:
- Outputs resume context (last session goal, outcome, next steps)
- Outputs smart status (health, actions, warnings)
- Starts a new session via CLI

**Do NOT call** `muninn_resume`, `muninn_smart_status`, or `muninn_session_start` at startup.
They are already provided in your initial context.

### Before Editing Files (MANDATORY)
```
muninn_check [files...]  → Pre-edit warnings (fragility, issues, staleness)
```
If fragility >= 7, explain your approach and wait for approval.

### During Work
```
muninn_query "topic"     → Search for relevant context
muninn_focus_set "area"  → Set focus to boost related results
muninn_bookmark_add      → Save important snippets for later recall
```

### After Changes
```
muninn_file_add          → Update file knowledge
muninn_decision_add      → Record significant choices
muninn_learn_add         → Save insights for future sessions
```

---

## All 20 Tools

### Status & Intelligence
| Tool | Purpose |
|------|---------|
| `muninn_status` | Basic project state (JSON) |
| `muninn_smart_status` | Actionable status with recommendations |
| `muninn_fragile` | List files with high fragility scores |
| `muninn_resume` | Last session goal, outcome, next steps |
| `muninn_drift` | Detect stale knowledge and git changes |
| `muninn_check` | **Pre-edit warnings** — ALWAYS use before editing |
| `muninn_impact` | Blast radius analysis for a file |
| `muninn_conflicts` | Check if files changed since last query |

### Search
| Tool | Purpose |
|------|---------|
| `muninn_query` | Hybrid search (FTS + vector when available) |
| `muninn_vector_search` | Pure semantic similarity search |

**Search Modes:**
- `--fts` — Fast full-text search (know exact term)
- `--vector` — Semantic similarity (conceptual search)
- `--smart` — Claude re-ranking (best results)
- `--brief` — Concise summaries (quick overview)

### Working Memory
| Tool | Purpose |
|------|---------|
| `muninn_bookmark_add` | Save context for later recall |
| `muninn_bookmark_get` | Retrieve bookmarked content |
| `muninn_bookmark_list` | List all bookmarks |
| `muninn_bookmark_delete` | Delete a bookmark |
| `muninn_bookmark_clear` | Clear all bookmarks |

**Use bookmarks to:**
- Save code patterns you'll reference later
- Store decisions mid-session
- Keep important snippets without bloating context window

### Focus
| Tool | Purpose |
|------|---------|
| `muninn_focus_set` | Set current work area |
| `muninn_focus_get` | Show current focus |
| `muninn_focus_clear` | Clear focus |

**Focus boosts results** from the specified area in all queries.

### Memory Updates
| Tool | Purpose |
|------|---------|
| `muninn_file_add` | Record file purpose and fragility |
| `muninn_decision_add` | Record architectural decisions |
| `muninn_issue_add` | Track bugs and problems |
| `muninn_issue_resolve` | Mark issues as fixed |
| `muninn_learn_add` | Save learnings (project or global) |

### Utilities
| Tool | Purpose |
|------|---------|
| `muninn_ship` | Pre-deploy checklist |
| `muninn_debt_add` | Track technical debt |
| `muninn_debt_list` | List all tech debt |
| `muninn_embed` | Manage vector embeddings |
| `muninn_deps` | Query file dependencies |

---

## Quick Reference

### Search Strategy
| Situation | Use |
|-----------|-----|
| Know exact term | `muninn_query "term" --fts` |
| Conceptual search | `muninn_query "concept" --vector` |
| Need best results | `muninn_query "topic" --smart` |
| Quick overview | `muninn_query "topic" --brief` |

### When to Use What
| Scenario | Tool |
|----------|------|
| Start of session | Automatic (hook provides resume + status) |
| About to edit a file | `muninn_check` (MANDATORY) |
| Need specific context | `muninn_query` |
| Found useful pattern | `muninn_bookmark_add` |
| Working on feature X | `muninn_focus_set "X"` |
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

*Query, don't preload. The tools are in your tool list.*
