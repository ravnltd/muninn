# Changelog

All notable changes to Muninn are documented here.

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
