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
