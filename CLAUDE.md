# CLAUDE.md — Context Memory System

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

**Do NOT call** `context_resume`, `context_smart_status`, or `context_session_start` at startup.
They are already provided in your initial context.

### Before Editing Files (MANDATORY)
```
context_check [files...]  → Pre-edit warnings (fragility, issues, staleness)
```
If fragility >= 7, explain your approach and wait for approval.

### During Work
```
context_query "topic"     → Search for relevant context
context_focus_set "area"  → Set focus to boost related results
context_bookmark_add      → Save important snippets for later recall
```

### After Changes
```
context_file_add          → Update file knowledge
context_decision_add      → Record significant choices
context_learn_add         → Save insights for future sessions
```

---

## All 20 Tools

### Status & Intelligence
| Tool | Purpose |
|------|---------|
| `context_status` | Basic project state (JSON) |
| `context_smart_status` | Actionable status with recommendations |
| `context_fragile` | List files with high fragility scores |
| `context_resume` | Last session goal, outcome, next steps |
| `context_drift` | Detect stale knowledge and git changes |
| `context_check` | **Pre-edit warnings** — ALWAYS use before editing |
| `context_impact` | Blast radius analysis for a file |
| `context_conflicts` | Check if files changed since last query |

### Search
| Tool | Purpose |
|------|---------|
| `context_query` | Hybrid search (FTS + vector when available) |
| `context_vector_search` | Pure semantic similarity search |

**Search Modes:**
- `--fts` — Fast full-text search (know exact term)
- `--vector` — Semantic similarity (conceptual search)
- `--smart` — Claude re-ranking (best results)
- `--brief` — Concise summaries (quick overview)

### Working Memory
| Tool | Purpose |
|------|---------|
| `context_bookmark_add` | Save context for later recall |
| `context_bookmark_get` | Retrieve bookmarked content |
| `context_bookmark_list` | List all bookmarks |
| `context_bookmark_delete` | Delete a bookmark |
| `context_bookmark_clear` | Clear all bookmarks |

**Use bookmarks to:**
- Save code patterns you'll reference later
- Store decisions mid-session
- Keep important snippets without bloating context window

### Focus
| Tool | Purpose |
|------|---------|
| `context_focus_set` | Set current work area |
| `context_focus_get` | Show current focus |
| `context_focus_clear` | Clear focus |

**Focus boosts results** from the specified area in all queries.

### Memory Updates
| Tool | Purpose |
|------|---------|
| `context_file_add` | Record file purpose and fragility |
| `context_decision_add` | Record architectural decisions |
| `context_issue_add` | Track bugs and problems |
| `context_issue_resolve` | Mark issues as fixed |
| `context_learn_add` | Save learnings (project or global) |

### Utilities
| Tool | Purpose |
|------|---------|
| `context_ship` | Pre-deploy checklist |
| `context_debt_add` | Track technical debt |
| `context_debt_list` | List all tech debt |
| `context_embed` | Manage vector embeddings |
| `context_deps` | Query file dependencies |

---

## Quick Reference

### Search Strategy
| Situation | Use |
|-----------|-----|
| Know exact term | `context_query "term" --fts` |
| Conceptual search | `context_query "concept" --vector` |
| Need best results | `context_query "topic" --smart` |
| Quick overview | `context_query "topic" --brief` |

### When to Use What
| Scenario | Tool |
|----------|------|
| Start of session | Automatic (hook provides resume + status) |
| About to edit a file | `context_check` (MANDATORY) |
| Need specific context | `context_query` |
| Found useful pattern | `context_bookmark_add` |
| Working on feature X | `context_focus_set "X"` |
| Made a decision | `context_decision_add` |
| Modified a file | `context_file_add` |
| Learned something | `context_learn_add` |

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
