# CLAUDE.md — Context Memory System

You have native tools for project memory. Use them.

## Your Memory Tools

These are **native tools** in your tool list (not bash commands):

| Tool | When to Use |
|------|-------------|
| `context_status` | **Start of every session** — understand the project |
| `context_fragile` | **Before editing files** — check what's dangerous |
| `context_query` | **Before any change** — search for relevant context |
| `context_file_add` | **After modifying a file** — update memory |
| `context_decision_add` | **After making a choice** — record decisions |
| `context_issue_add` | **When finding problems** — track issues |
| `context_learn_add` | **When learning something** — save for later |
| `context_ship` | **Before deploying** — run checklist |

## Required Workflow

### Session Start
1. Call `context_status` to see project state
2. Call `context_fragile` to see dangerous files

### Before Any Change
1. Call `context_query` with what you're about to touch
2. If fragility >= 7, explain approach and wait for approval

### After Any Change
1. Call `context_file_add` for modified files
2. Call `context_decision_add` for significant choices
3. Call `context_learn_add` for insights

## Quality Standards

- **No `any` type** without justification
- **Max 30 lines** per function
- **Single responsibility** per file
- **Early returns** for edge cases
- **Zod validation** at boundaries

## Red Flags — Stop and Ask

- Modifying file with fragility >= 7
- Changing > 3 files for a "simple" task
- Adding new dependencies
- Changing API contracts
- Scope creeping ("while I'm here...")

---

*The tools are in your tool list. Use them.*
