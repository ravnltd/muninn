# Muninn v9 — The Ambient Brain

## Vision

Muninn v9 is a ground-up rethink of how AI memory should work. The current system
(v8) is powerful but heavy — 47 tables, 13+ MCP tools, 26 passthrough commands,
4 hooks, and a 12-step mandatory workflow. It works because it forces compliance.
v9 works because it's so fast and useful that skipping it feels like coding blind.

**One sentence:** Memory that breathes with you instead of memory you perform rituals for.

---

## Design Principles

### 1. Ambient Over Procedural
Memory should work like your actual brain — you don't consciously "store" or "retrieve."
You just know things when you need them, and you learn by doing, not by filing paperwork.

### 2. One In, One Out
One tool to get context. One tool to record something novel. Everything else is automatic.

### 3. Infer, Don't Ask
File knowledge from diffs. Decisions from structural changes. Sessions from activity gaps.
Co-changes from git. Fragility from signals. The system observes; the user works.

### 4. Push, Don't Pull
Warnings surface IN recall results. Drift detection runs async and attaches to future
queries. Intelligence finds you — you don't hunt for it.

### 5. Useful, Not Enforced
No blocking hooks. No mandatory steps. No ceremony. If the tool is good enough,
I'll use it every time because it helps, not because a hook stops me if I don't.

---

## Architecture: Three Layers

```
┌──────────────────────────────────────────────────┐
│              LAYER 3: INTELLIGENCE               │
│                                                  │
│  Async background processing. Detects drift,     │
│  repeat mistakes, emerging patterns. Surfaces     │
│  as warnings attached to recall results.          │
│                                                  │
│  Runs: on session end, on commit, periodically    │
│  Outputs to: warnings column on files/decisions   │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│              LAYER 2: CAPTURE                    │
│                                                  │
│  Automatic. Post-edit hook extracts:              │
│  - File purpose/type from content analysis        │
│  - Co-change updates from git                     │
│  - Decision detection from structural diffs       │
│  - Fragility recomputation                        │
│                                                  │
│  Only manual input: remember("novel insight")     │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│              LAYER 1: RETRIEVAL                  │
│                                                  │
│  ONE tool: recall                                 │
│  Input: file paths OR natural language query       │
│  Output: everything relevant, one call, <100ms    │
│                                                  │
│  Replaces: query, predict, suggest, check,        │
│           context, enrich (6 tools → 1)           │
└──────────────────────────────────────────────────┘
```

---

## Tool Design (4 Tools Total)

### Tool 1: `recall` — The Only Retrieval Tool

Replaces: muninn_query, muninn_predict, muninn_suggest, muninn_check,
muninn_context, muninn_enrich (6 tools → 1)

```typescript
// Schema
{
  name: "recall",
  input: {
    // Provide ONE of these:
    files: string[],        // Pre-edit mode: "tell me about these files"
    query: string,          // Search mode: "what do I know about auth?"
    task: string,           // Planning mode: "I need to add rate limiting"
  }
}
```

**Behavior by input shape:**

| Input | Intent | Returns |
|-------|--------|---------|
| `files` | Pre-edit | Fragility, co-changers, decisions, issues, blast radius, warnings |
| `query` | Search | Hybrid FTS+vector results from all tables, ranked |
| `task` | Planning | Related files, decisions, learnings, issues, advisory |

**Key behaviors:**
- Files mode marks files as "recalled" (replaces check enforcement)
- All modes return attached warnings (drift, staleness, high fragility)
- All modes use hybrid search (FTS 0.4 + vector 0.6)
- Results include confidence scores for transparency
- Latency target: <100ms for files mode, <200ms for search/task mode

**Output format (native):**
```
RECALL files:[src/api/routes.ts]
F[src/api/routes.ts|frag:6|api-handler|Main API route definitions]
  co-changes: src/api/middleware.ts (12x), src/api/types.ts (8x)
  warnings: stale (changed 3 days ago, not analyzed)
D[Rate limiting approach|choice:token-bucket|why:simple, proven|conf:8]
I[#42|sev:5|bug|Auth timeout on slow connections]
K[gotcha|ent:routes.ts|when:adding routes|do:update openapi spec too|conf:7]
B[score:45|direct:8|trans:23|tests:4|risk:medium]
```

### Tool 2: `remember` — The Only Write Tool

Replaces: muninn_learn_add, muninn_decision_add (2 tools → 1)

```typescript
{
  name: "remember",
  input: {
    content: string,          // Natural language. System auto-categorizes.
    type?: "decision" | "learning" | "issue",  // Optional hint
    files?: string[],         // Related files (optional)
    severity?: number,        // For issues only (1-10)
  }
}
```

**Auto-categorization logic:**
- Contains "chose X over Y" or "decided to" → decision
- Contains "found bug" or "broken" or "fails when" → issue
- Everything else → learning
- User can override with `type` parameter

**Key behaviors:**
- Embeddings generated immediately (inline, not background)
- Deduplication check before insert (vector similarity > 0.9 = update existing)
- Returns confirmation with ID and detected type

### Tool 3: `track` — Issue Management

Replaces: muninn_issue (kept separate because issues have lifecycle)

```typescript
{
  name: "track",
  input: {
    action: "add" | "resolve",
    // For add:
    title?: string,
    description?: string,
    severity?: number,       // 1-10, default 5
    // For resolve:
    id?: number,
    resolution?: string,
  }
}
```

### Tool 4: `muninn` — Admin Passthrough (Reduced)

Keep for administrative commands only. Dramatically reduced whitelist:

```
status          → Project health summary
reindex         → Rebuild indexes and embeddings
db migrate      → Run migrations
db backup       → Manual backup
```

Everything else is handled by recall, remember, track, or automatic capture.
Kill: focus, bookmark, observe, profile, workflow, outcome, insights,
temporal, correlations, team, ownership, onboarding, blast, deps,
drift, conflicts, pattern, stack, debt, foundational, brief, resume,
smart-status, session

Most of these are either:
- Subsumed by recall (blast, deps, drift, conflicts, focus, smart-status)
- Subsumed by auto-capture (observe, profile, workflow, session)
- Subsumed by remember (bookmark, foundational)
- Low-value (temporal, correlations, team, onboarding, pattern, stack, brief)

---

## Schema: 47 Tables → 8 Tables

### Keep (core)

| Table | Purpose | Changes |
|-------|---------|---------|
| `projects` | Project metadata | Remove mode, simplify |
| `files` | File knowledge + fragility | Absorb symbols as JSON metadata |
| `decisions` | Architectural choices | Keep outcome tracking, drop links table |
| `learnings` | All knowledge | Absorb observations, insights, global learnings, profiles |
| `issues` | Bugs and tech debt | Absorb techDebt |
| `sessions` | Work sessions | Auto-managed, no manual start/end |
| `file_correlations` | Co-change tracking | Keep as-is (computed from git) |
| `_migrations` | Schema management | Simplified |

### Keep (infrastructure, read-only)

| Table | Purpose | Changes |
|-------|---------|---------|
| `tool_calls` | Tool usage log | Keep for analytics, fragility signals |
| `error_events` | Error history | Keep for fragility scoring |

### Drop (30+ tables)

**Merged into `learnings`:**
- observations → learnings with category="observation"
- insights → learnings with category="insight", source="auto"
- globalLearnings → learnings with global=true
- developerProfile/globalDeveloperProfile → learnings with category="preference"
- openQuestions → learnings with category="question"
- workflowPatterns → learnings with category="workflow"
- patterns → learnings with category="pattern"
- qualityStandards → learnings with category="standard"

**Merged into `files`:**
- symbols → JSON column on files (exports already has this shape)
- blastRadius/blastSummary → computed on demand from call_graph
- native_knowledge → format layer, not data

**Merged into `issues`:**
- techDebt → issues with type="debt"

**Dropped entirely:**
- bookmarks (use remember instead)
- focus (auto-inferred from queries)
- modeTransitions (unnecessary tracking)
- consolidations (complexity for marginal value)
- decisionLinks (rarely queried)
- relationships (computed from call_graph)
- All infrastructure tables: servers, services, routes, serviceDeps,
  deployments, infraEvents, secretsRegistry (move to separate tool)
- securityFindings, dependencyVulnerabilities, qualityMetrics,
  performanceFindings (move to CI/CD, not memory)
- shipHistory (use git tags)
- call_graph (keep for fragility computation, but simplify)
- test_source_map (keep for fragility, simplify)
- diff_analyses (merge into sessions or drop)

### New Schema (simplified)

```sql
-- Core: 8 tables

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  stack TEXT,  -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  path TEXT NOT NULL,
  purpose TEXT,
  type TEXT,  -- component, util, config, etc.
  fragility INTEGER DEFAULT 1,  -- 1-10, auto-computed
  fragility_signals TEXT,  -- JSON breakdown
  symbols TEXT,  -- JSON: [{name, type, signature}]
  embedding BLOB,
  content_hash TEXT,
  last_analyzed TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, path)
);

CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  title TEXT NOT NULL,
  decision TEXT NOT NULL,
  reasoning TEXT,
  affects TEXT,  -- JSON array of file paths
  status TEXT DEFAULT 'active',  -- active, superseded
  outcome TEXT,  -- succeeded, failed, revised
  outcome_notes TEXT,
  embedding BLOB,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE learnings (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,  -- NULL = global
  category TEXT NOT NULL,  -- pattern, gotcha, preference, convention, observation, insight, workflow, question
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  context TEXT,  -- when this applies
  source TEXT DEFAULT 'manual',  -- manual, auto, inferred
  confidence INTEGER DEFAULT 5,  -- 1-10
  files TEXT,  -- JSON array of related file paths
  embedding BLOB,
  times_applied INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issues (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'bug',  -- bug, debt, security, performance
  severity INTEGER DEFAULT 5,  -- 1-10
  status TEXT DEFAULT 'open',  -- open, resolved
  affected_files TEXT,  -- JSON
  resolution TEXT,
  resolved_at TEXT,
  embedding BLOB,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  goal TEXT,
  outcome TEXT,
  success INTEGER,  -- 0=failed, 1=partial, 2=success
  files_touched TEXT,  -- JSON
  next_steps TEXT,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT
);

CREATE TABLE file_correlations (
  project_id INTEGER,
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  cochange_count INTEGER DEFAULT 1,
  PRIMARY KEY (project_id, file_a, file_b)
);

CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,
  tool TEXT NOT NULL,
  args TEXT,  -- JSON
  duration_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE error_events (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,
  file_path TEXT,
  error_type TEXT,
  message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- FTS indexes (3, not 9)
CREATE VIRTUAL TABLE fts_files USING fts5(path, purpose, type);
CREATE VIRTUAL TABLE fts_decisions USING fts5(title, decision, reasoning);
CREATE VIRTUAL TABLE fts_learnings USING fts5(title, content, context);

-- Regular indexes
CREATE INDEX idx_files_project ON files(project_id);
CREATE INDEX idx_files_fragility ON files(project_id, fragility);
CREATE INDEX idx_decisions_project ON decisions(project_id, status);
CREATE INDEX idx_learnings_project ON learnings(project_id, category);
CREATE INDEX idx_issues_project ON issues(project_id, status);
CREATE INDEX idx_sessions_project ON sessions(project_id, started_at);
```

---

## Hooks: 4 → 2

### Keep: session-start-context.sh (simplified)
- Load last session context on startup
- Show warnings (stale files, open issues)
- Auto-start session (background)
- NO "required actions" ceremony

### Keep: post-edit-capture.sh (new, replaces post-edit-track + enforce-check)
- Runs AFTER edit completes (non-blocking)
- Extracts: file path, diff summary
- Updates: file knowledge, co-changes, fragility recompute
- Detects: structural decisions (new deps, new patterns)
- NO pre-edit blocking. NO enforcement.

### Kill: enforce-check.sh
The recall tool is useful enough that I'll call it voluntarily.
Blocking edits is hostile UX that solves distrust with punishment.

### Kill: user-prompt-context.sh
Context injection moves INTO the recall tool output.
No need for a separate hook injecting stale cached context.

---

## Automatic Capture System

### Post-Edit Auto-Capture (Layer 2 core)

When a file is edited, the post-edit hook triggers:

```
1. Get git diff for the file
2. If file is new:
   - Infer purpose from filename + first 50 lines
   - Infer type from path (src/components/ → component, etc.)
   - Create file record with fragility=1
3. If file exists:
   - Update content_hash
   - Mark as needing fragility recompute
4. Update file_correlations:
   - All files edited in this session are co-changers
   - Increment cochange_count for each pair
5. Decision detection (lightweight):
   - New import of external package → potential decision
   - New file in new directory → potential architectural choice
   - Significant structural change (>50% diff) → flag for review
   - Queue for confirmation: "Captured: added express-rate-limit for API throttling. Correct?"
```

### Session Auto-Management

```
- Session starts: on first recall/remember call
- Session goal: inferred from first task/query
- Session ends: on process shutdown OR 30min inactivity
- Session outcome: inferred from:
  - Were tests run? Did they pass?
  - Was there a commit? What was the message?
  - Were issues resolved?
  - How many files were edited vs read?
```

### Fragility Auto-Computation

Keep the 7-factor model but make it fully automatic:
- Dependent count: from import analysis (reindex)
- Test coverage: from test_source_map (reindex)
- Change velocity: from git log (computed on recall)
- Error history: from error_events table
- Export surface: from file symbols
- Complexity proxy: from file symbols
- Manual override: REMOVED (auto-only)

Runs: after reindex, after significant edits, on recall if stale

---

## The Workflow (Before vs After)

### Current v8 (12 steps):
```
1. muninn_predict "task"           ← planning
2. muninn_suggest "task"           ← more planning
3. muninn_query "topic"            ← even more planning
4. muninn "focus set --area X"     ← ceremony
5. muninn_check file.ts            ← pre-edit (enforced)
6. [edit file]
7. muninn_file_add                 ← manual capture
8. muninn_decision_add             ← manual capture
9. muninn_learn_add                ← manual capture
10. muninn_issue (if applicable)   ← manual capture
11. muninn_session end             ← ceremony
12. muninn_ship (if deploying)     ← ceremony
```

### New v9 (1-3 steps):
```
1. recall({files: ["src/api/routes.ts"]})  ← everything I need
2. [edit file]
   ← auto-captured by post-edit hook
   ← co-changes updated automatically
   ← fragility recomputed automatically
   ← decision detected and queued for confirmation
3. remember("rate limiter needs warm-up period")  ← only if novel
```

**That's it.** 12 steps → 1-3 steps. 6 retrieval tools → 1. 4 write tools → 1.
Everything else is automatic.

---

## Migration Path

### Phase 1: Build `recall` (the retrieval unifier)
- Create new tool that combines query/predict/suggest/check/context logic
- Smart routing based on input shape (files vs query vs task)
- Single output format with all context
- Keep old tools working (backward compat)
- **Test:** recall returns same quality as predict+suggest+check combined

### Phase 2: Build `remember` (the write simplifier)
- Create tool with auto-categorization
- Deduplication via vector similarity
- Inline embedding generation
- Keep old write tools working
- **Test:** remember correctly categorizes decisions vs learnings

### Phase 3: Build auto-capture
- New post-edit hook that extracts file knowledge from diffs
- Co-change tracking from session file list
- Decision detection from structural changes
- **Test:** editing a file auto-updates file record without manual file_add

### Phase 4: Schema migration
- Create new simplified schema
- Migrate data from 47 tables → 8 tables
- Merge observations/insights/profiles into learnings
- Merge symbols into files
- Merge techDebt into issues
- **Test:** all existing data accessible through new schema

### Phase 5: Kill ceremony
- Remove enforce-check hook
- Remove user-prompt-context hook
- Remove session start/end tools (auto-managed)
- Remove focus/bookmark/observe tools
- Reduce passthrough whitelist to 4 commands
- **Test:** full workflow works with only recall + remember + track

### Phase 6: Ambient intelligence
- Warnings auto-attach to recall results
- Drift detection runs async, results cached
- Pattern detection writes to learnings automatically
- Contradiction detection surfaces in recall
- **Test:** recall surfaces a warning about a drifted decision without explicit query

---

## What We Kill and Why

| What | Why It Dies |
|------|-------------|
| muninn_query | Subsumed by recall (search mode) |
| muninn_predict | Subsumed by recall (task mode) |
| muninn_suggest | Subsumed by recall (task mode, semantic) |
| muninn_check | Subsumed by recall (files mode) |
| muninn_context | Was already the v7 unifier — recall is v9's |
| muninn_enrich | Auto-context moves into recall |
| muninn_approve | Remove blocking entirely |
| muninn_file_add | Auto-capture from post-edit hook |
| muninn_decision_add | Subsumed by remember (auto-categorized) |
| muninn_learn_add | Subsumed by remember (auto-categorized) |
| muninn_session | Auto-managed (start on first call, end on shutdown) |
| enforce-check hook | No blocking. recall is useful enough voluntarily |
| user-prompt-context hook | Context moves into recall output |
| focus command | Auto-inferred from recent queries |
| bookmark command | Use remember instead |
| observe command | Auto-detected from patterns |
| profile command | Merged into learnings |
| workflow command | Auto-tracked, no manual tool |
| insights command | Merged into learnings, auto-generated |
| outcome command | Simplified — decisions track their own outcomes |
| 30+ database tables | Merged or dropped (see schema section) |

---

## Risk Assessment

### What Could Go Wrong

1. **Auto-capture misses important decisions**
   Mitigation: `remember` is always available for manual recording.
   Auto-capture is additive, not exclusive.

2. **recall is slower because it does more**
   Mitigation: Parallel queries (Promise.allSettled), aggressive caching,
   intent-based routing to skip irrelevant queries.

3. **Losing data in schema migration**
   Mitigation: Migration script maps every row. Old schema kept as backup.
   Dual-write period during transition.

4. **Without enforcement, I skip recall**
   Mitigation: If recall is fast (<100ms) and useful (returns actionable context),
   skipping it is irrational. The current system needs enforcement because the
   workflow is 12 steps. At 1 step, the cost/benefit flips.

5. **Auto-categorization gets it wrong**
   Mitigation: remember returns what it detected ("Saved as: decision").
   User can correct with explicit type parameter. System learns from corrections.

### What We Gain

- **10x fewer tool calls per task** (12 → 1-3)
- **Zero ceremony** (no sessions, no focus, no bookmarks)
- **Zero blocking** (no enforce-check, no approve)
- **Simpler codebase** (~60% less MCP code, ~70% fewer tables)
- **Faster onboarding** (learn 4 tools, not 40)
- **Same intelligence** (fragility, blast radius, co-changes, decisions, learnings)
- **Better intelligence** (auto-capture catches things manual recording misses)

---

## Implementation Order

```
Phase 1: recall tool                    ← highest value, enables everything
Phase 2: remember tool                  ← simplifies write path
Phase 3: auto-capture hook              ← eliminates manual recording
Phase 4: schema migration               ← simplifies data layer
Phase 5: kill ceremony                  ← removes enforcement and old tools
Phase 6: ambient intelligence           ← push-based warnings
```

Each phase is independently shippable. Phase 1 alone is a massive improvement.
After Phase 1, I can use recall + the old write tools while we build the rest.

---

## Success Criteria

1. **recall returns equivalent context to predict+suggest+check combined** in one call
2. **Tool calls per task drop from 8-12 to 1-3** measured across 10 sessions
3. **No data loss** during schema migration (verified by row count comparison)
4. **Auto-capture records 80%+ of file changes** without manual file_add
5. **Latency: recall <100ms (files), <200ms (search/task)**
6. **Zero blocking hooks** — all enforcement removed, quality maintained

---

*This is the plan. Phase 1 is the foundation. Everything builds on recall.*
