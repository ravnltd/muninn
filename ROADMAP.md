# Muninn — Roadmap

This document outlines planned features that are not yet implemented. Features are organized by category and priority.

## Implemented ✅

### Intelligence Commands
- [x] `check <files...>` — Pre-edit warnings (fragility, issues, staleness)
- [x] `impact <file>` — Analyze what depends on a file
- [x] `smart-status` / `ss` — Actionable status with recommendations
- [x] `drift` — Detect knowledge drift (stale files + git changes)
- [x] `conflicts <files...>` — Check if files changed since last query
- [x] `brief` — Smart session brief
- [x] `resume` — Resume from last session

### Dependency Commands
- [x] `deps <file>` — Show imports and dependents
- [x] `deps --refresh` — Rebuild dependency graph
- [x] `deps --graph` — Generate Mermaid diagram
- [x] `deps --cycles` — Find circular dependencies

### Memory Commands
- [x] File, decision, issue, learning management
- [x] Pattern library
- [x] Tech debt tracking

### Vector Search
- [x] Hybrid search (FTS + vector)
- [x] Voyage AI embeddings integration

---

## Planned Features

### 🔒 Security Commands (Priority: Medium)

#### `secure [files...]`
OWASP security scan for common vulnerabilities:
- SQL injection detection
- XSS vulnerability patterns
- Path traversal risks
- Command injection patterns
- Insecure deserialization

**Implementation notes:**
- Use regex patterns for common vulnerability signatures
- Integrate with existing file reading infrastructure
- Output severity-ranked findings

#### `secrets [files...]`
Detect hardcoded secrets and API keys:
- API keys (AWS, GCP, Azure, Stripe, etc.)
- Database connection strings
- Private keys and certificates
- JWT tokens and passwords in code

**Implementation notes:**
- Use pattern matching for known secret formats
- Check for common env var names in string literals
- Scan git history with `--history` flag

#### `audit`
Check dependencies for known vulnerabilities:
- Parse package.json/lock files
- Query npm audit / advisory databases
- Report CVEs with severity

**Implementation notes:**
- Use npm audit JSON output
- Cache results to avoid repeated API calls

---

### 📊 Quality Commands (Priority: Medium)

#### `quality [files...]`
Code quality analysis:
- Cyclomatic complexity scoring
- Function length analysis
- Nesting depth detection
- `any` type usage in TypeScript
- `@ts-ignore` count

**Implementation notes:**
- Parse AST for complexity metrics
- Use TypeScript compiler API for type analysis

#### `types`
TypeScript type coverage analysis:
- Percentage of typed vs untyped code
- List of `any` usages with locations
- Missing return types
- Implicit `any` from inference failures

#### `test-gen <file>`
Generate Vitest tests for a file:
- Analyze exports and function signatures
- Generate test stubs with happy path and edge cases
- Use LLM API for intelligent test generation

**Implementation notes:**
- Requires ANTHROPIC_API_KEY
- Parse file exports to understand what to test

#### `review <file>`
AI-powered code review:
- Security issues
- Performance concerns
- Best practice violations
- Refactoring suggestions

**Implementation notes:**
- Send file content to LLM API
- Return structured review with line references

---

### ⚡ Performance Commands (Priority: Low)

#### `perf [files...]`
Detect performance issues:
- N+1 query patterns
- Synchronous operations in async contexts
- Large bundle imports
- Missing memoization opportunities
- Unbatched database operations

**Implementation notes:**
- Pattern matching for common anti-patterns
- Framework-specific rules (React, Next.js, etc.)

#### `queries`
Database query analysis:
- Find raw SQL in codebase
- Detect missing indexes hints
- Identify inefficient query patterns
- Track query count per endpoint

---

### 📈 Growth Commands (Priority: Low)

#### `growth`
Analyze virality potential:
- Share button presence
- Referral system detection
- Social proof elements
- User-generated content features

#### `scaffold <type>`
Generate growth features:
- `scaffold referral` — Referral system
- `scaffold share` — Social sharing
- `scaffold invite` — Invite system
- `scaffold waitlist` — Waitlist management

---

### 🔧 Developer Experience (Priority: Medium)

#### `hooks`
Install git hooks for auto-updates:
- Pre-commit: Update file knowledge on changes
- Post-checkout: Detect drift
- Post-merge: Sync knowledge base

**Implementation notes:**
- Generate hook scripts in `.git/hooks/`
- Make hooks configurable via `.muninnrc`

#### `suggest <task>`
AI suggests files for a task:
- Parse task description
- Search knowledge base for relevant context
- Rank files by relevance to task
- Suggest starting points

**Implementation notes:**
- Use embedding similarity for file ranking
- Consider dependency graph for related files

---

### 🌐 Collaboration Features (Priority: Low)

#### Team sync
- Shared knowledge base
- Conflict resolution for decisions
- Multi-user session tracking

#### Remote storage
- Sync to cloud storage (S3, GCS)
- Share context between machines
- Team-wide learnings

---

## Technical Debt

### Current Limitations
1. **No incremental analysis** — Full re-analysis required for updates
2. **Memory usage** — Large projects may hit memory limits
3. **No caching** — Repeated operations aren't cached
4. **Single-threaded** — Could benefit from parallel processing

### Planned Improvements
1. Incremental file analysis based on git diff
2. LRU cache for frequently accessed data
3. Worker threads for parallel file processing
4. Compressed storage for embeddings

---

## Contributing

Want to implement a feature? Here's how:

1. Pick a feature from this roadmap
2. Create a new file in `src/commands/` following existing patterns
3. Add routing in `src/index.ts`
4. Add MCP tool in `src/mcp-server.ts` if needed
5. Update help text
6. Test with `bun run src/index.ts <command>`

### Code Standards
- TypeScript strict mode
- Max 30 lines per function
- Zod validation at boundaries
- Error handling with Result types
- No `any` without justification

---

*Last updated: January 2026*
