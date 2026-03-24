# Changelog

All notable changes to Muninn are documented here.

## [9.0.0] — 2026-03-23

Radical simplification. 4 tools replace 40+ commands. Memory that compounds automatically.

### Added
- **4-tool API**: `recall`, `remember`, `track`, `muninn` — zero ceremony, complete coverage
- **Ambient brain**: recall returns pre-edit context bundles (fragility, co-changers, decisions, issues, blast radius) in a single call
- **Self-healing stability**: auto-migration in HTTP mode, graceful degradation throughout
- **Intelligence layer**: compounding memory with learning graduation, decision grounding, file correlations, and fragility scoring
- **`npx muninn-ai` installer**: one-command setup with auto-detection for Claude Code, Cursor, Windsurf, Continue.dev
- **Session hooks**: auto-installed via symlinks, lifecycle management with background workers

### Changed
- Tool count reduced from 40+ CLI commands to 4 MCP tools
- `recall` replaces predict, suggest, query, check, context, and enrich
- `remember` replaces decision_add, learn_add, file_add (auto-categorizes)
- `track` replaces issue add/resolve/list
- README rewritten for the 4-tool API

### Fixed
- Migrations now auto-apply in HTTP mode (43 missing tables restored)
- AGPL-3.0-only relicense (was PolyForm Noncommercial)
- Comprehensive security hardening (29 issues across all severity levels)

## [8.0.0] — 2026-02-23

Universal AI memory platform. Complete rewrite of the intelligence layer.

### Added
- Agent self-awareness: task-type success rates, behavioral profiling, scope creep detection
- 7 closed feedback loops: strategies, predictions, staleness, impact stats, budget overrides, A/B conclusions, trajectory
- Unified context router with 2000-token budget across 8 categories
- Dynamic budget adjustments based on trajectory (exploration/failing/stuck/confident)
- Intelligence collector aggregating all signals via Promise.allSettled
- Multi-agent support via REST API
- Cognitive memory with anticipatory intelligence

### Changed
- MCP server runs handlers in-process (no CLI spawning)
- Context budget is now self-tuning based on measured helpfulness
- Session analysis extracts learnings automatically
- License changed from PolyForm Noncommercial to AGPL-3.0-only

### Fixed
- Comprehensive security hardening (29 issues across all severity levels)
- Circuit breaker v2 with exponential backoff and exception classification
- Mid-session death recovery for MCP server
- File path normalization at MCP entry point
- SSH prompt hangs during update checks

## [6.0.0] — 2026-02-10

Category leadership release.

### Added
- Knowledge explorer and metrics dashboard
- Risk alerts and archive restore
- SvelteKit product website and dashboard
- Enterprise features: RBAC, SSO/SAML, persistent rate limiting
- Audit logging and compliance tooling

## [5.0.0] — 2026-02-05

Intelligence release.

### Added
- Bayesian learning with confidence decay
- Composite fragility scoring
- Hybrid retrieval (FTS + vector + LLM re-ranking)
- Contradiction detection
- Progressive refinement

## [4.0.0] — 2026-01-30

AI-first memory system.

### Added
- Adaptive review cadence for decisions
- Batch commands for bulk operations
- Code intel enricher (symbols, blast radius)
- Hook integration layer for passive context delivery
- Memory as a Service API (Phase 1)

## [3.0.0] — 2026-01-25

Performance release.

### Changed
- MCP Server v3: in-process handlers replace CLI spawning
- LRU cache for HTTP adapter reads
- 15s timeout on learning extraction API calls

## [2.0.0] — 2026-01-20

Multi-machine support.

### Added
- HTTP mode for stateless remote connections
- Hub-and-spoke architecture with sqld
- Daily backup system
- Auto-update check on session startup

### Changed
- Global database for all projects (replaces per-project DBs)

## [1.0.0] — 2026-01-18

Initial release.

### Added
- SQLite-backed project memory (files, decisions, issues, learnings, sessions)
- MCP server with 10 tools (9 core + 1 passthrough)
- Vector search with Voyage AI and local Transformers.js fallback
- Smart search with Anthropic LLM re-ranking
- CLI with 40+ commands
- Automatic session management via hooks
- Fragility scoring and pre-edit safety checks
- Developer profile and preference tracking
