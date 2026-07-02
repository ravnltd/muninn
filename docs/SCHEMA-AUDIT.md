# Schema Audit — v10 Schema Diet (2026-07-01)

Full-codebase audit of the ~97 real tables (86 base + 11 FTS) against what
runtime code actually reads and writes. Methodology: SQL-context references
(FROM/INTO/UPDATE/JOIN) across `src/`, excluding pure DDL files
(`migrations/versions.ts`, `connection/schema-init.ts`, Drizzle `schema.ts`)
and `cloud/` (separate database).

## Dropped (migration v51)

Seven tables with **no runtime reader or writer anywhere** and 0 rows on the
hub at drop time:

`agent_handoffs`, `agent_profiles`, `agent_scratchpad`, `deployments`,
`mode_transitions`, `quality_standards`, `ab_tests`

The unreachable `src/outcomes/ab-testing.ts` module was deleted with them.

## Frozen (22 tables — legacy CLI only, do NOT drop without checking data)

Written/read only by `src/index.ts` CLI commands unreachable from MCP tools,
hooks, or worker jobs. They may hold real data; dropping them requires a
per-table data check and removing the owning command.

| Cluster | Tables | Owning commands |
|---|---|---|
| Conversations | `conversations`, `conversation_messages`, `conversation_extracts`, `fts_conversation_messages`, `pattern_instances` | `commands/{conversations,extraction,conversation-analysis}` |
| Infra registry | `servers`, `services`, `routes`, `service_deps`, `infra_events` | `commands/infra/*` |
| Enrichment | `enrichment_metrics`, `pending_approvals` | `commands/enrich.ts`, `src/enrichment/*` |
| Global-tier CLI | `global_developer_profile`, `global_observations`, `global_open_questions`, `global_workflow_patterns` | `commands/{profile,observe,questions,workflow}` |
| Singletons | `bookmarks`, `consolidations`, `learning_conflicts`, `reflection_questions`, `ship_history`, `blast_radius` | `commands/{bookmark,consolidation,continuous-learning,reflection,ship,blast}` |

## Live (68 tables)

Everything else — the v9/v10 hot paths (recall/remember/track/capture,
context-cache, prompt-map), migration machinery, FTS indexes, worker jobs
(including `src/team/*` and `src/agents/intent-manager.ts`, which the worker
imports dynamically), and MCP resources.

Note: the legacy `context_injections` table (v7 context router) is **live**
via `src/outcomes/*` — the v10 injection feedback ledger is the separate
`injection_ledger` table (migration v50) for exactly this reason.

## Next diet steps (when appetite exists)

1. Decide the fate of the conversation + infra clusters (likely: extract to a
   separate tool or delete commands + tables after data export).
2. `blast_radius` vs `blast_summary`: only `blast_summary` is live; migrating
   the remaining CLI readers would free `blast_radius`.
3. Re-run this audit after removing any legacy CLI command.
