/**
 * Core Muninn Tool Documentation
 *
 * Universal instructions that work across all editors.
 * Each editor adapter wraps these in its own format.
 */

export const CORE_INSTRUCTIONS = `## Muninn Memory Tools

This project uses Muninn for persistent AI memory across sessions.

### Before Editing Files
\`muninn_check [files...]\` — Pre-edit warnings (fragility, issues, staleness)

### Core Tools
| Tool | Purpose |
|------|---------|
| muninn_query | Search project memory |
| muninn_check | Pre-edit warnings (always use before editing) |
| muninn_suggest | Semantic file suggestions |
| muninn_predict | FTS-based context bundle |
| muninn_file_add | Record file knowledge |
| muninn_decision_add | Record decisions |
| muninn_learn_add | Save learnings |
| muninn_issue | Track issues (add/resolve) |
| muninn_session | Manage sessions (start/end) |

### After Changes
- muninn_file_add — Update file knowledge
- muninn_decision_add — Record significant choices
- muninn_learn_add — Save insights for future sessions

### Query Strategy
| Situation | Tool |
|-----------|------|
| Know exact term | muninn_query with fts mode |
| Conceptual search | muninn_query with vector mode |
| Find related files | muninn_suggest |
| Bundle task context | muninn_predict |
`;
