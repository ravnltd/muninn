# Changelog

All notable changes to Muninn will be documented in this file.

## [2.0.0] - 2025-01-24

Complete rewrite as a semantic memory system for AI-assisted development.

### Added

- **MCP Server**: 10 tools (9 core + 1 passthrough) for Claude Code integration
- **Web Dashboard**: Visual project explorer with multi-project support
- **Local Embeddings**: Offline vector search via Transformers.js (384 dimensions)
- **Intelligence System**: Developer profiles, predictions, outcomes, temporal analysis
- **Insight Engine**: Cross-session pattern detection with signal-based generation
- **Session Management**: Automatic session tracking via Claude Code hooks
- **Blast Radius Engine**: Transitive dependency analysis for impact assessment
- **Semantic Code Chunking**: Function-level search with signature extraction
- **File Correlations**: Track which files change together
- **Knowledge Graph**: Relationships between files, decisions, issues, learnings
- **Focus System**: Scope queries to current work area
- **Bookmarks**: Session-scoped working memory
- **Pre-edit Checks**: Fragility warnings before modifying files
- **Smart Status**: Health checks, velocity anomalies, stale knowledge detection
- **Drizzle ORM**: Type-safe database access with migrations

### Changed

- Renamed from `claude-context` to `muninn`
- Refactored monolithic `context.ts` (5,173 lines) into modular `src/` structure
- Switched from Vitest to Bun's native test runner
- Adopted Biome for linting and formatting
- Hybrid MCP approach: full schemas for core tools, passthrough for CLI access

### Infrastructure

- SQLite database per project (`.claude/` directory)
- Global database for cross-project features (`~/.claude/`)
- Pre-commit hooks for typecheck, lint, and test
- PolyForm Noncommercial 1.0.0 license

## [1.0.0] - 2025-01-18

Initial release as `claude-context`.

### Added

- CLI for project context management
- File, decision, issue, and learning tracking
- Basic session support
- SQLite storage
