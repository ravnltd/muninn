-- Muninn Database Schema
-- Auto-generated from database at migration v45
-- Generated: 2026-03-20
--
-- DO NOT EDIT — regenerate with: bun run scripts/generate-schema.ts
-- Source of truth: src/database/migrations/versions.ts

PRAGMA foreign_keys = ON;

-- ============================================================================
-- TABLES (150)
-- ============================================================================

CREATE TABLE _error_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL,
        error_code TEXT,
        message TEXT NOT NULL,
        context TEXT,
        stack TEXT
      );

CREATE TABLE _migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration_ms INTEGER,
        checksum TEXT,
        UNIQUE(version)
      );

CREATE TABLE _migration_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE _schema_checksums (
        table_name TEXT PRIMARY KEY,
        column_hash TEXT NOT NULL,
        index_hash TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE ab_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    test_name TEXT NOT NULL,
    control_config TEXT NOT NULL,
    variant_config TEXT NOT NULL,
    metric TEXT NOT NULL,
    min_sessions INTEGER DEFAULT 20,
    control_sessions INTEGER DEFAULT 0,
    variant_sessions INTEGER DEFAULT 0,
    control_metric_sum REAL DEFAULT 0,
    variant_metric_sum REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    conclusion TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    concluded_at DATETIME,
    UNIQUE(project_id,
    test_name)
);

CREATE TABLE agent_handoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    from_agent_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    assumptions TEXT DEFAULT '[]',
    warnings TEXT DEFAULT '[]',
    next_steps TEXT DEFAULT '[]',
    consumed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    agent_id TEXT NOT NULL,
    intent_type TEXT NOT NULL,
    target_files TEXT DEFAULT '[]',
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
);

CREATE TABLE agent_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    domains_touched TEXT DEFAULT '[]',
    success_rate REAL DEFAULT 0.5,
    preferred_tools TEXT DEFAULT '[]',
    session_count INTEGER DEFAULT 0,
    last_active_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    agent_id)
);

CREATE TABLE agent_scratchpad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    agent_id TEXT,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    key)
);

CREATE TABLE archived_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    reason TEXT NOT NULL,
    archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE blast_radius (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_file TEXT NOT NULL,            -- File being changed
        affected_file TEXT NOT NULL,          -- File that would be affected
        distance INTEGER NOT NULL DEFAULT 1,  -- Hops: 1=direct, 2+=transitive
        dependency_path TEXT,                 -- JSON array: path from source to affected
        is_test INTEGER DEFAULT 0,            -- 1 if affected_file is a test
        is_route INTEGER DEFAULT 0,           -- 1 if affected_file is a route/page
        computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, source_file, affected_file)
      );

CREATE TABLE blast_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,              -- The file being summarized
        direct_dependents INTEGER DEFAULT 0,  -- Count of distance=1
        transitive_dependents INTEGER DEFAULT 0, -- Count of distance>1
        total_affected INTEGER DEFAULT 0,     -- Total unique affected files
        max_depth INTEGER DEFAULT 0,          -- Deepest transitive chain
        affected_tests INTEGER DEFAULT 0,     -- Count of affected test files
        affected_routes INTEGER DEFAULT 0,    -- Count of affected route files
        blast_score REAL DEFAULT 0.0,         -- Computed risk score (0-100)
        computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, file_path)
      );

CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT,
    content_type TEXT DEFAULT 'text',
    priority INTEGER DEFAULT 3,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    UNIQUE(project_id, label)
);

CREATE TABLE budget_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    context_type TEXT NOT NULL,
    recommended_budget INTEGER NOT NULL,
    reason TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    context_type)
);

CREATE TABLE call_graph (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    caller_file TEXT NOT NULL,
    caller_symbol TEXT NOT NULL,
    callee_file TEXT NOT NULL,
    callee_symbol TEXT NOT NULL,
    call_type TEXT NOT NULL DEFAULT 'direct',
    confidence REAL DEFAULT 0.8,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE code_ownership (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    primary_author TEXT NOT NULL,
    commit_count INTEGER DEFAULT 0,
    line_count INTEGER DEFAULT 0,
    last_commit_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    file_path)
);

CREATE TABLE codebase_dna (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dna_json TEXT NOT NULL,
    formatted_text TEXT NOT NULL,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id)
);

CREATE TABLE cognitive_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    project TEXT DEFAULT '',
    created_at REAL NOT NULL
);

CREATE TABLE consolidations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        source_ids TEXT NOT NULL,
        summary_title TEXT NOT NULL,
        summary_content TEXT NOT NULL,
        entity_count INTEGER NOT NULL,
        confidence REAL DEFAULT 0.8,
        embedding BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE context_injections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    context_type TEXT NOT NULL,
    source_id INTEGER,
    content_hash TEXT NOT NULL,
    tokens INTEGER NOT NULL DEFAULT 0,
    relevance_score REAL DEFAULT 0.0,
    was_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP ,
    relevance_signal TEXT DEFAULT NULL
);

CREATE TABLE contradiction_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    current_action TEXT NOT NULL,
    contradiction_summary TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    dismissed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversation_extracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    confidence REAL,
    excerpt TEXT,
    extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    message_index INTEGER NOT NULL,
    timestamp TEXT,
    model TEXT,
    char_count INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    external_id TEXT,
    title TEXT,
    started_at TEXT,
    ended_at TEXT,
    participant_model TEXT,
    message_count INTEGER DEFAULT 0,
    user_message_count INTEGER DEFAULT 0,
    assistant_message_count INTEGER DEFAULT 0,
    total_chars INTEGER DEFAULT 0,
    tags TEXT,
    notes TEXT,
    extraction_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    project_id INTEGER REFERENCES projects(id),
    UNIQUE(source,
    external_id)
);

CREATE TABLE decision_learnings (
    decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
    learning_id INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
    contribution TEXT NOT NULL DEFAULT 'influenced',
    linked_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (decision_id,
    learning_id)
);

CREATE TABLE decision_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        linked_decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL,              -- 'depends_on', 'invalidates', 'requires_reconsider', 'supersedes', 'contradicts'
        strength REAL DEFAULT 0.5,            -- 0-1 how tightly coupled
        reason TEXT,                          -- why these are linked
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(decision_id, linked_decision_id, link_type)
      );

CREATE TABLE decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,                    -- "Use SQLite over Postgres"
    decision TEXT NOT NULL,                 -- What was decided
    reasoning TEXT,                         -- Why it was decided
    alternatives TEXT,                      -- JSON array of rejected alternatives
    consequences TEXT,                      -- JSON array of implications
    affects TEXT,                           -- JSON array of affected areas/files
    status TEXT DEFAULT 'active',           -- active, superseded, reconsidering
    superseded_by INTEGER REFERENCES decisions(id),
    decided_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    embedding BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, invariant TEXT, constraint_type TEXT DEFAULT 'should_hold', temperature TEXT DEFAULT 'cold', last_referenced_at DATETIME, outcome_status TEXT DEFAULT 'pending', outcome_notes TEXT, outcome_at DATETIME, check_after_sessions INTEGER DEFAULT 5, sessions_since INTEGER DEFAULT 0, archived_at TEXT, consolidated_into INTEGER, content_hash_snapshot TEXT);

CREATE TABLE deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      previous_version TEXT,
      deployed_by TEXT,
      deploy_method TEXT,
      status TEXT DEFAULT 'pending',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      duration_seconds INTEGER,
      output TEXT,
      error TEXT,
      rollback_version TEXT,
      notes TEXT
    );

CREATE TABLE developer_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        evidence TEXT,
        confidence REAL DEFAULT 0.5,
        category TEXT NOT NULL,
        source TEXT DEFAULT 'inferred',
        times_confirmed INTEGER DEFAULT 1,
        embedding BLOB,
        last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, key)
      );

CREATE TABLE diff_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_id INTEGER NOT NULL REFERENCES git_commits(id) ON DELETE CASCADE,
    intent_summary TEXT,
    intent_category TEXT NOT NULL DEFAULT 'unknown',
    changed_functions TEXT,
    complexity_delta INTEGER DEFAULT 0,
    analyzed_by TEXT DEFAULT 'heuristic',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(commit_id)
);

CREATE TABLE enrichment_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool TEXT NOT NULL,
    file_path TEXT,
    latency_ms INTEGER NOT NULL,
    enrichers_used TEXT,
    tokens_injected INTEGER,
    blocked INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    cache_misses INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE error_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    error_signature TEXT,
    source_file TEXT,
    stack_trace TEXT,
    tool_call_id INTEGER REFERENCES tool_calls(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE error_fix_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    error_signature TEXT NOT NULL,
    error_type TEXT NOT NULL,
    error_example TEXT,
    fix_commit_hash TEXT,
    fix_description TEXT,
    fix_files TEXT,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    times_seen INTEGER DEFAULT 1,
    times_fixed INTEGER DEFAULT 1,
    confidence REAL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    error_signature)
);

CREATE TABLE file_correlations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_a TEXT NOT NULL,               -- First file path
        file_b TEXT NOT NULL,               -- Second file path (alphabetically after file_a)
        cochange_count INTEGER DEFAULT 1,   -- How many times changed together
        last_cochange DATETIME DEFAULT CURRENT_TIMESTAMP,
        avg_time_gap_seconds INTEGER,       -- Average time between changes
        correlation_strength REAL,          -- 0-1 calculated strength
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, file_a, file_b)
      );

CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,                     -- relative to project: src/lib/auth.ts
    type TEXT,                              -- component, util, config, route, schema, test
    purpose TEXT,                           -- "Handles user authentication and session management"
    exports TEXT,                           -- JSON array of exported functions/classes
    dependencies TEXT,                      -- JSON array of imports
    dependents TEXT,                        -- JSON array of files that import this
    fragility INTEGER DEFAULT 0,            -- 0-10 scale, how careful to be
    fragility_reason TEXT,                  -- "Complex legacy code, no tests"
    status TEXT DEFAULT 'active',           -- active, deprecated, do-not-touch, generated
    last_modified DATETIME,
    last_analyzed DATETIME,
    embedding BLOB,                         -- Vector embedding for semantic search
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, content_hash TEXT, fs_modified_at TEXT, last_queried_at TEXT, temperature TEXT DEFAULT 'cold', last_referenced_at DATETIME, velocity_score REAL DEFAULT 0.0, change_count INTEGER DEFAULT 0, first_changed_at DATETIME, archived_at TEXT, consolidated_into INTEGER, fragility_signals TEXT DEFAULT NULL, fragility_computed_at DATETIME DEFAULT NULL,
    UNIQUE(project_id, path)
);

CREATE TABLE focus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    area TEXT NOT NULL,
    description TEXT,
    files TEXT,
    keywords TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    cleared_at DATETIME,
    UNIQUE(project_id, session_id)
);

CREATE VIRTUAL TABLE fts_cognitive_events USING fts5(content, event_type, project, content=cognitive_events, content_rowid=id);

CREATE TABLE 'fts_cognitive_events_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_cognitive_events_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_cognitive_events_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_cognitive_events_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_conversation_messages USING fts5( content, content='conversation_messages', content_rowid='id' );

CREATE TABLE 'fts_conversation_messages_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_conversation_messages_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_conversation_messages_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_conversation_messages_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_decisions USING fts5 (title, decision, reasoning);

CREATE TABLE 'fts_decisions_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_decisions_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1,
    c2
);

CREATE TABLE 'fts_decisions_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_decisions_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_decisions_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_files USING fts5 (path, purpose, type);

CREATE TABLE 'fts_files_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_files_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1,
    c2
);

CREATE TABLE 'fts_files_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_files_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_files_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_global_learnings USING fts5 (title, content, context);

CREATE TABLE 'fts_global_learnings_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_global_learnings_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1,
    c2
);

CREATE TABLE 'fts_global_learnings_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_global_learnings_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_global_learnings_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_issues USING fts5(title, description, workaround, resolution);

CREATE TABLE 'fts_issues_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_issues_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1,
    c2,
    c3
);

CREATE TABLE 'fts_issues_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_issues_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_issues_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_learnings USING fts5 (title, content, context);

CREATE TABLE 'fts_learnings_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_learnings_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1,
    c2
);

CREATE TABLE 'fts_learnings_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_learnings_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_learnings_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_observations USING fts5( content, type );

CREATE TABLE 'fts_observations_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_observations_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1
);

CREATE TABLE 'fts_observations_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_observations_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_observations_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_patterns USING fts5 (name, description, code_example);

CREATE TABLE 'fts_patterns_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_patterns_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1,
    c2
);

CREATE TABLE 'fts_patterns_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_patterns_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_patterns_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_questions USING fts5( question, context );

CREATE TABLE 'fts_questions_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_questions_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1
);

CREATE TABLE 'fts_questions_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_questions_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_questions_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE VIRTUAL TABLE fts_symbols USING fts5 (name, purpose, content_rowid=id);

CREATE TABLE 'fts_symbols_config'(
    k PRIMARY KEY,
    v) WITHOUT ROWID;

CREATE TABLE 'fts_symbols_content'(
    id INTEGER PRIMARY KEY,
    c0,
    c1
);

CREATE TABLE 'fts_symbols_data'(
    id INTEGER PRIMARY KEY,
    block BLOB
);

CREATE TABLE 'fts_symbols_docsize'(
    id INTEGER PRIMARY KEY,
    sz BLOB
);

CREATE TABLE 'fts_symbols_idx'(
    segid,
    term,
    pgno,
    PRIMARY KEY(segid,
    term)) WITHOUT ROWID;

CREATE TABLE git_commits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_hash TEXT NOT NULL,
    author TEXT,
    message TEXT NOT NULL,
    files_changed TEXT,
    insertions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    analyzed INTEGER DEFAULT 0,
    committed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    commit_hash)
);

CREATE TABLE global_developer_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        evidence TEXT,
        confidence REAL DEFAULT 0.5,
        category TEXT NOT NULL,
        source TEXT DEFAULT 'inferred',
        times_confirmed INTEGER DEFAULT 1,
        last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE global_learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      source_project TEXT,
      confidence INTEGER DEFAULT 5,
      times_applied INTEGER DEFAULT 0,
      last_applied DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE global_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'insight',
      content TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      source_project TEXT,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE global_open_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      context TEXT,
      priority INTEGER DEFAULT 3,
      status TEXT DEFAULT 'open',
      resolution TEXT,
      source_project TEXT,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE global_workflow_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL UNIQUE,
      approach TEXT NOT NULL,
      preferences TEXT,
      examples TEXT,
      times_used INTEGER DEFAULT 1,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE health_score_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    components TEXT NOT NULL,
    computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE impact_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    context_type TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    outcome_signal TEXT NOT NULL DEFAULT 'unknown',
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE infra_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        evidence TEXT,
        confidence REAL DEFAULT 0.5,
        status TEXT DEFAULT 'new',
        generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        acknowledged_at DATETIME,
        embedding BLOB, shown_count INTEGER DEFAULT 0,
        UNIQUE(project_id, title)
      );

CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'bug',                -- bug, tech-debt, enhancement, question
    severity INTEGER DEFAULT 5,             -- 1-10 scale
    status TEXT DEFAULT 'open',             -- open, in-progress, resolved, wont-fix
    affected_files TEXT,                    -- JSON array of file paths
    related_symbols TEXT,                   -- JSON array of function/component names
    workaround TEXT,                        -- Temporary fix if any
    resolution TEXT,                        -- How it was fixed
    resolved_at DATETIME,
    embedding BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
, temperature TEXT DEFAULT 'cold', last_referenced_at DATETIME, archived_at TEXT, consolidated_into INTEGER);

CREATE TABLE knowledge_freshness (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    staleness_score REAL DEFAULT 0,
    last_validated_at DATETIME,
    deps_changed_count INTEGER DEFAULT 0,
    flagged_stale INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    source_table,
    source_id)
);

CREATE TABLE learning_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    learning_a INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
    learning_b INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
    conflict_type TEXT NOT NULL DEFAULT 'potential',
    similarity_score REAL,
    detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    resolution TEXT,
    resolution_notes TEXT,
    UNIQUE(learning_a,
    learning_b)
);

CREATE TABLE learning_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    learning_id INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    confidence INTEGER,
    changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    change_reason TEXT
);

CREATE TABLE learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE, -- NULL = global learning
    category TEXT NOT NULL,                 -- pattern, gotcha, preference, convention
    title TEXT NOT NULL,
    content TEXT NOT NULL,                  -- The actual learning
    context TEXT,                           -- When this applies
    source TEXT,                            -- How this was learned (session ID, user instruction, etc.)
    confidence INTEGER DEFAULT 5,           -- 1-10, how sure we are this is correct
    times_applied INTEGER DEFAULT 0,        -- How often this has been used
    last_applied DATETIME,
    embedding BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
, temperature TEXT DEFAULT 'cold', last_referenced_at DATETIME, archived_at TEXT, consolidated_into INTEGER, foundational INTEGER DEFAULT 0, review_after_sessions INTEGER, sessions_since_review INTEGER DEFAULT 0, review_status TEXT DEFAULT 'pending', reviewed_at DATETIME, promotion_status TEXT DEFAULT 'not_ready', times_confirmed INTEGER DEFAULT 0, promoted_at DATETIME, promoted_to_section TEXT, last_reinforced_at TEXT, decay_rate REAL DEFAULT 0.05, auto_reinforcement_count INTEGER DEFAULT 0, stage TEXT DEFAULT 'validated');

CREATE TABLE mode_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        from_mode TEXT,
        to_mode TEXT NOT NULL,
        reason TEXT,                          -- why the transition happened
        transitioned_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE native_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  entities TEXT NOT NULL,
  condition TEXT,
  action TEXT,
  reasoning TEXT,
  confidence INTEGER DEFAULT 80,
  embedding BLOB,
  source_id INTEGER NOT NULL,
  source_table TEXT NOT NULL,
  native_format TEXT NOT NULL,
  original_tokens INTEGER,
  native_tokens INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_table, source_id)
);

CREATE TABLE observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'insight',  -- pattern, frustration, insight, dropped_thread, preference, behavior
        content TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,           -- Auto-incremented on dedup
        session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
        embedding BLOB,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE onboarding_contexts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    content TEXT NOT NULL,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    UNIQUE(project_id,
    section)
);

CREATE TABLE open_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        context TEXT,
        priority INTEGER DEFAULT 3,            -- 1-5 (1=highest)
        status TEXT DEFAULT 'open',            -- open, resolved, dropped
        resolution TEXT,
        session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
        embedding BLOB,
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE pattern_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    pattern_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    entity_refs TEXT,
    conversation_ids TEXT,
    aggregate_confidence REAL DEFAULT 0,
    frequency INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      code_example TEXT,
      anti_pattern TEXT,
      applies_to TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE pending_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT UNIQUE NOT NULL,
    tool TEXT NOT NULL,
    file_path TEXT,
    reason TEXT NOT NULL,
    block_level TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    approved_at DATETIME
);

CREATE TABLE pr_review_extracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pr_number INTEGER,
    review_category TEXT NOT NULL,
    pattern TEXT NOT NULL,
    example TEXT,
    reviewer TEXT,
    occurrence_count INTEGER DEFAULT 1,
    promoted_to_learning INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    review_category,
    pattern)
);

CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      stack TEXT,
      status TEXT DEFAULT 'active',
      mode TEXT DEFAULT 'exploring',
      previous_paths TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE quality_standards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT DEFAULT 'warning',
      auto_fixable INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE reasoning_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    problem_signature TEXT NOT NULL,
    hypothesis_chain TEXT NOT NULL DEFAULT '[]',
    dead_ends TEXT NOT NULL DEFAULT '[]',
    breakthrough TEXT,
    strategy_tags TEXT NOT NULL DEFAULT '[]',
    tool_sequence TEXT NOT NULL DEFAULT '[]',
    outcome TEXT DEFAULT 'unknown',
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reflection_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    pattern_id INTEGER REFERENCES pattern_instances(id),
    question_type TEXT NOT NULL,
    question TEXT NOT NULL,
    context TEXT,
    source_entities TEXT,
    conversation_ids TEXT,
    confidence REAL,
    status TEXT DEFAULT 'open',
    answer TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    answered_at TEXT
);

CREATE TABLE relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,              -- file, symbol, decision, issue
    source_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    relationship TEXT NOT NULL,             -- imports, calls, affects, blocks, supersedes, related
    strength INTEGER DEFAULT 5,             -- 1-10 how strong the relationship
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_type, source_id, target_type, target_id, relationship)
);

CREATE TABLE retrieval_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    context_type TEXT NOT NULL,
    item_id INTEGER,
    item_path TEXT,
    was_suggested INTEGER DEFAULT 0,
    was_used INTEGER DEFAULT 0,
    relevance_score REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE revert_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revert_commit_hash TEXT NOT NULL,
    original_commit_hash TEXT,
    original_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    revert_type TEXT NOT NULL DEFAULT 'message',
    files_affected TEXT,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed INTEGER DEFAULT 0
);

CREATE TABLE risk_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    title TEXT NOT NULL,
    details TEXT,
    source_file TEXT,
    dismissed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      path TEXT DEFAULT '/',
      service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
      method TEXT DEFAULT '*',
      proxy_type TEXT,
      ssl_type TEXT,
      rate_limit TEXT,
      auth_required INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(domain, path, method)
    );

CREATE TABLE servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      hostname TEXT,
      ip_addresses TEXT,
      role TEXT,
      ssh_user TEXT DEFAULT 'root',
      ssh_port INTEGER DEFAULT 22,
      ssh_key_path TEXT,
      ssh_jump_host TEXT,
      os TEXT,
      resources TEXT,
      tags TEXT,
      status TEXT DEFAULT 'unknown',
      last_seen DATETIME,
      last_health_check DATETIME,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE service_deps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      depends_on_service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      depends_on_external TEXT,
      dependency_type TEXT,
      connection_env_var TEXT,
      required INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      type TEXT,
      runtime TEXT,
      port INTEGER,
      health_endpoint TEXT,
      health_status TEXT DEFAULT 'unknown',
      last_health_check DATETIME,
      response_time_ms INTEGER,
      config TEXT,
      env_file TEXT,
      project_path TEXT,
      git_repo TEXT,
      git_branch TEXT DEFAULT 'main',
      current_version TEXT,
      deploy_command TEXT,
      restart_command TEXT,
      stop_command TEXT,
      log_command TEXT,
      status TEXT DEFAULT 'unknown',
      auto_restart INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, name)
    );

CREATE TABLE session_learnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        learning_id INTEGER REFERENCES learnings(id) ON DELETE SET NULL,
        extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confidence REAL,                    -- 0-1 confidence in the extraction
        auto_applied INTEGER DEFAULT 0      -- Whether it was automatically saved
      );

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    goal TEXT,                              -- What we set out to do
    outcome TEXT,                           -- What actually happened
    files_touched TEXT,                     -- JSON array of modified files
    decisions_made TEXT,                    -- JSON array of decision IDs
    issues_found TEXT,                      -- JSON array of issue IDs
    issues_resolved TEXT,                   -- JSON array of issue IDs
    learnings TEXT,                         -- What Claude learned
    next_steps TEXT,                        -- What should happen next
    success INTEGER                         -- 0 = failed, 1 = partial, 2 = success
, files_read TEXT, patterns_used TEXT, queries_made TEXT, session_number INTEGER, task_type TEXT);

CREATE TABLE ship_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      version TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      checks_passed TEXT,
      checks_failed TEXT,
      notes TEXT
    );

CREATE TABLE strategy_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    trigger_conditions TEXT NOT NULL DEFAULT '[]',
    tool_pattern TEXT,
    success_rate REAL DEFAULT 0.5,
    times_used INTEGER DEFAULT 0,
    avg_duration_ms INTEGER DEFAULT 0,
    source_trace_ids TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    name)
);

CREATE TABLE symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                     -- createUser, UserProfile, AUTH_CONFIG
    type TEXT NOT NULL,                     -- function, class, component, constant, type
    signature TEXT,                         -- (input: CreateUserInput) => Promise<User>
    purpose TEXT,                           -- "Creates a new user with hashed password"
    parameters TEXT,                        -- JSON description of params
    returns TEXT,                           -- Description of return value
    side_effects TEXT,                      -- JSON array: ["database write", "sends email"]
    callers TEXT,                           -- JSON array of functions that call this
    calls TEXT,                             -- JSON array of functions this calls
    complexity INTEGER DEFAULT 0,           -- 0-10 scale
    embedding BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE team_learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_learning_id INTEGER,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    contributor TEXT,
    confidence REAL DEFAULT 0.7,
    times_confirmed INTEGER DEFAULT 0,
    is_global INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    title)
);

CREATE TABLE tech_debt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      severity INTEGER DEFAULT 5,
      effort TEXT,
      affected_files TEXT,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_hash TEXT,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    test_command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    total_tests INTEGER DEFAULT 0,
    passed INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    output_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE test_source_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    test_file TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_symbol TEXT,
    match_type TEXT NOT NULL DEFAULT 'naming',
    confidence REAL DEFAULT 0.7,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    test_file,
    source_file,
    source_symbol)
);

CREATE TABLE tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    tool_name TEXT NOT NULL,
    input_summary TEXT,
    files_involved TEXT,
    success INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP ,
    recall_result_ids TEXT
);

CREATE TABLE value_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    contradictions_prevented INTEGER DEFAULT 0,
    context_injections INTEGER DEFAULT 0,
    context_hit_rate REAL DEFAULT 0,
    decisions_recalled INTEGER DEFAULT 0,
    learnings_applied INTEGER DEFAULT 0,
    sessions_with_context INTEGER DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    month)
);

CREATE TABLE work_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME ,
    duration_ms INTEGER
);

CREATE TABLE workflow_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        task_type TEXT NOT NULL,               -- code_review, debugging, feature_build, creative, research, refactor
        approach TEXT NOT NULL,
        preferences TEXT,                      -- JSON object
        examples TEXT,                         -- JSON array
        times_used INTEGER DEFAULT 1,
        last_used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, task_type)
      );

CREATE TABLE workflow_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    trigger_sequence TEXT NOT NULL,
    predicted_tool TEXT NOT NULL,
    predicted_args TEXT,
    times_correct INTEGER DEFAULT 0,
    times_total INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,
    trigger_sequence,
    predicted_tool)
);

-- ============================================================================
-- VIEWS (6)
-- ============================================================================

CREATE VIEW v_blast_tests AS
      SELECT
        br.source_file,
        br.affected_file as test_file,
        br.distance,
        br.dependency_path,
        p.name as project_name
      FROM blast_radius br
      JOIN projects p ON br.project_id = p.id
      WHERE br.is_test = 1
      ORDER BY br.distance ASC
/* v_blast_tests(source_file,test_file,distance,dependency_path,project_name) */;

CREATE VIEW v_decision_ripple AS
      SELECT
        d1.id as decision_id,
        d1.title as decision_title,
        dl.link_type,
        dl.strength,
        d2.id as linked_id,
        d2.title as linked_title,
        d2.status as linked_status
      FROM decisions d1
      JOIN decision_links dl ON d1.id = dl.decision_id
      JOIN decisions d2 ON dl.linked_decision_id = d2.id
      WHERE d2.status = 'active'
      ORDER BY dl.strength DESC
/* v_decision_ripple(decision_id,decision_title,link_type,strength,linked_id,linked_title,linked_status) */;

CREATE VIEW v_fragile_files AS
SELECT 
    f.*,
    p.name as project_name,
    p.path as project_path
FROM files f
JOIN projects p ON f.project_id = p.id
WHERE f.fragility >= 7 OR f.status = 'do-not-touch'
ORDER BY f.fragility DESC
/* v_fragile_files(id,project_id,path,type,purpose,exports,dependencies,dependents,fragility,fragility_reason,status,last_modified,last_analyzed,embedding,created_at,updated_at,content_hash,fs_modified_at,last_queried_at,temperature,last_referenced_at,velocity_score,change_count,first_changed_at,archived_at,consolidated_into,project_name,project_path) */;

CREATE VIEW v_high_impact_files AS
      SELECT
        bs.file_path,
        bs.blast_score,
        bs.total_affected,
        bs.affected_tests,
        bs.affected_routes,
        bs.max_depth,
        f.fragility,
        f.purpose,
        p.name as project_name
      FROM blast_summary bs
      JOIN projects p ON bs.project_id = p.id
      LEFT JOIN files f ON bs.project_id = f.project_id AND bs.file_path = f.path
      WHERE bs.blast_score >= 50
      ORDER BY bs.blast_score DESC
/* v_high_impact_files(file_path,blast_score,total_affected,affected_tests,affected_routes,max_depth,fragility,purpose,project_name) */;

CREATE VIEW v_project_state AS
SELECT 
    p.*,
    (SELECT COUNT(*) FROM files WHERE project_id = p.id) as file_count,
    (SELECT COUNT(*) FROM issues WHERE project_id = p.id AND status = 'open') as open_issues,
    (SELECT COUNT(*) FROM decisions WHERE project_id = p.id AND status = 'active') as active_decisions,
    (SELECT goal FROM sessions WHERE project_id = p.id ORDER BY started_at DESC LIMIT 1) as last_goal,
    (SELECT next_steps FROM sessions WHERE project_id = p.id ORDER BY started_at DESC LIMIT 1) as pending_next_steps
FROM projects p
/* v_project_state(id,path,name,type,stack,status,created_at,updated_at,mode,previous_paths,file_count,open_issues,active_decisions,last_goal,pending_next_steps) */;

CREATE VIEW v_recent_activity AS
SELECT 
    'session' as type,
    s.id,
    s.project_id,
    p.name as project_name,
    s.goal as summary,
    s.started_at as timestamp
FROM sessions s
JOIN projects p ON s.project_id = p.id
UNION ALL
SELECT 
    'decision' as type,
    d.id,
    d.project_id,
    p.name as project_name,
    d.title as summary,
    d.decided_at as timestamp
FROM decisions d
JOIN projects p ON d.project_id = p.id
UNION ALL
SELECT 
    'issue' as type,
    i.id,
    i.project_id,
    p.name as project_name,
    i.title as summary,
    i.created_at as timestamp
FROM issues i
JOIN projects p ON i.project_id = p.id
ORDER BY timestamp DESC
LIMIT 50
/* v_recent_activity(type,id,project_id,project_name,summary,timestamp) */;

-- ============================================================================
-- INDEXES (193)
-- ============================================================================

CREATE INDEX idx_ab_tests_project ON ab_tests(project_id);
CREATE INDEX idx_ab_tests_status ON ab_tests(status);
CREATE INDEX idx_agent_handoffs_consumed ON agent_handoffs(consumed);
CREATE INDEX idx_agent_handoffs_project ON agent_handoffs(project_id);
CREATE INDEX idx_agent_intents_agent ON agent_intents(agent_id);
CREATE INDEX idx_agent_intents_project ON agent_intents(project_id);
CREATE INDEX idx_agent_intents_status ON agent_intents(status);
CREATE INDEX idx_agent_profiles_project ON agent_profiles(project_id);
CREATE INDEX idx_agent_scratchpad_key ON agent_scratchpad(key);
CREATE INDEX idx_agent_scratchpad_project ON agent_scratchpad(project_id);
CREATE INDEX idx_approvals_expires ON pending_approvals(expires_at);
CREATE INDEX idx_approvals_file ON pending_approvals(file_path);
CREATE INDEX idx_approvals_operation ON pending_approvals(operation_id);
CREATE INDEX idx_archived_project ON archived_knowledge(project_id);
CREATE INDEX idx_archived_source ON archived_knowledge(source_table, source_id);
CREATE INDEX idx_blast_radius_affected ON blast_radius(affected_file);
CREATE INDEX idx_blast_radius_distance ON blast_radius(distance);
CREATE INDEX idx_blast_radius_project ON blast_radius(project_id);
CREATE INDEX idx_blast_radius_routes ON blast_radius(project_id, is_route) WHERE is_route = 1;
CREATE INDEX idx_blast_radius_source ON blast_radius(source_file);
CREATE INDEX idx_blast_radius_tests ON blast_radius(project_id, is_test) WHERE is_test = 1;
CREATE INDEX idx_blast_summary_file ON blast_summary(file_path);
CREATE INDEX idx_blast_summary_project ON blast_summary(project_id);
CREATE INDEX idx_blast_summary_score ON blast_summary(blast_score DESC);
CREATE INDEX idx_bookmarks_label ON bookmarks(label);
CREATE INDEX idx_bookmarks_priority ON bookmarks(priority);
CREATE INDEX idx_bookmarks_project ON bookmarks(project_id);
CREATE INDEX idx_bookmarks_session ON bookmarks(session_id);
CREATE INDEX idx_budget_recs_project ON budget_recommendations(project_id);
CREATE INDEX idx_call_graph_callee ON call_graph(callee_file, callee_symbol);
CREATE INDEX idx_call_graph_caller ON call_graph(caller_file, caller_symbol);
CREATE INDEX idx_call_graph_project ON call_graph(project_id);
CREATE INDEX idx_codebase_dna_project ON codebase_dna(project_id);
CREATE INDEX idx_conflicts_learning_a ON learning_conflicts(learning_a);
CREATE INDEX idx_conflicts_learning_b ON learning_conflicts(learning_b);
CREATE INDEX idx_conflicts_unresolved ON learning_conflicts(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_consolidations_project ON consolidations(project_id);
CREATE INDEX idx_consolidations_type ON consolidations(entity_type);
CREATE INDEX idx_contradiction_dismissed ON contradiction_alerts(dismissed);
CREATE INDEX idx_contradiction_project ON contradiction_alerts(project_id);
CREATE INDEX idx_contradiction_session ON contradiction_alerts(session_id);
CREATE INDEX idx_conv_project ON conversations(project_id);
CREATE INDEX idx_conv_source ON conversations(source);
CREATE INDEX idx_conv_started ON conversations(started_at DESC);
CREATE INDEX idx_conv_title ON conversations(title);
CREATE INDEX idx_correlations_file_a ON file_correlations(file_a);
CREATE INDEX idx_correlations_file_b ON file_correlations(file_b);
CREATE INDEX idx_correlations_project ON file_correlations(project_id);
CREATE INDEX idx_correlations_strength ON file_correlations(correlation_strength DESC);
CREATE INDEX idx_ctx_inject_project ON context_injections(project_id);
CREATE INDEX idx_ctx_inject_session ON context_injections(session_id);
CREATE INDEX idx_ctx_inject_type ON context_injections(context_type);
CREATE INDEX idx_ctx_inject_used ON context_injections(was_used);
CREATE INDEX idx_decision_learnings_contribution ON decision_learnings(contribution);
CREATE INDEX idx_decision_learnings_decision ON decision_learnings(decision_id);
CREATE INDEX idx_decision_learnings_learning ON decision_learnings(learning_id);
CREATE INDEX idx_decision_links_decision ON decision_links(decision_id);
CREATE INDEX idx_decision_links_linked ON decision_links(linked_decision_id);
CREATE INDEX idx_decision_links_type ON decision_links(link_type);
CREATE INDEX idx_decisions_archived ON decisions(archived_at);
CREATE INDEX idx_decisions_project ON decisions(project_id);
CREATE INDEX idx_decisions_status ON decisions(status);
CREATE INDEX idx_deployments_service ON deployments (service_id);
CREATE INDEX idx_diff_analyses_category ON diff_analyses(intent_category);
CREATE INDEX idx_diff_analyses_commit ON diff_analyses(commit_id);
CREATE INDEX idx_diff_analyses_project ON diff_analyses(project_id);
CREATE INDEX idx_enrichment_latency ON enrichment_metrics(latency_ms);
CREATE INDEX idx_enrichment_time ON enrichment_metrics(created_at DESC);
CREATE INDEX idx_enrichment_tool ON enrichment_metrics(tool);
CREATE INDEX idx_error_events_project ON error_events(project_id);
CREATE INDEX idx_error_events_session ON error_events(session_id);
CREATE INDEX idx_error_events_signature ON error_events(error_signature);
CREATE INDEX idx_error_events_time ON error_events(created_at DESC);
CREATE INDEX idx_error_events_type ON error_events(error_type);
CREATE INDEX idx_error_fix_confidence ON error_fix_pairs(confidence DESC);
CREATE INDEX idx_error_fix_project ON error_fix_pairs(project_id);
CREATE INDEX idx_error_fix_signature ON error_fix_pairs(error_signature);
CREATE INDEX idx_error_fix_type ON error_fix_pairs(error_type);
CREATE INDEX idx_error_log_source ON _error_log(source);
CREATE INDEX idx_error_log_time ON _error_log(timestamp DESC);
CREATE INDEX idx_extract_conv ON conversation_extracts(conversation_id);
CREATE INDEX idx_extract_entity ON conversation_extracts(entity_type, entity_id);
CREATE INDEX idx_extract_type ON conversation_extracts(entity_type);
CREATE INDEX idx_files_archived ON files(archived_at);
CREATE INDEX idx_files_fragility ON files(fragility);
CREATE INDEX idx_files_project ON files(project_id);
CREATE UNIQUE INDEX idx_files_project_path ON files (project_id, path);
CREATE INDEX idx_files_status ON files(status);
CREATE INDEX idx_files_type ON files(type);
CREATE INDEX idx_files_velocity ON files(velocity_score DESC);
CREATE INDEX idx_focus_area ON focus(area);
CREATE INDEX idx_focus_project ON focus(project_id);
CREATE INDEX idx_focus_session ON focus(session_id);
CREATE INDEX idx_freshness_project ON knowledge_freshness(project_id);
CREATE INDEX idx_freshness_source ON knowledge_freshness(source_table, source_id);
CREATE INDEX idx_freshness_stale ON knowledge_freshness(staleness_score DESC);
CREATE INDEX idx_git_commits_analyzed ON git_commits(analyzed);
CREATE INDEX idx_git_commits_hash ON git_commits(commit_hash);
CREATE INDEX idx_git_commits_project ON git_commits(project_id);
CREATE INDEX idx_git_commits_time ON git_commits(committed_at DESC);
CREATE INDEX idx_health_score_date ON health_score_history(computed_at);
CREATE INDEX idx_health_score_project ON health_score_history(project_id);
CREATE INDEX idx_impact_project ON impact_tracking(project_id);
CREATE INDEX idx_impact_session ON impact_tracking(session_id);
CREATE INDEX idx_impact_signal ON impact_tracking(outcome_signal);
CREATE INDEX idx_impact_type ON impact_tracking(context_type);
CREATE INDEX idx_infra_events_server ON infra_events (server_id);
CREATE INDEX idx_insights_confidence ON insights(confidence DESC);
CREATE INDEX idx_insights_project ON insights(project_id);
CREATE INDEX idx_insights_status ON insights(status);
CREATE INDEX idx_issues_archived ON issues(archived_at);
CREATE INDEX idx_issues_project ON issues(project_id);
CREATE INDEX idx_issues_severity ON issues(severity);
CREATE INDEX idx_issues_status ON issues(status);
CREATE INDEX idx_issues_type ON issues(type);
CREATE INDEX idx_learnings_archived ON learnings(archived_at);
CREATE INDEX idx_learnings_category ON learnings(category);
CREATE INDEX idx_learnings_foundational_due
      ON learnings(project_id, foundational, review_status, sessions_since_review);
CREATE INDEX idx_learnings_project ON learnings(project_id);
CREATE INDEX idx_learnings_promotion
      ON learnings(project_id, promotion_status, foundational, confidence);
CREATE INDEX idx_learnings_reinforcement ON learnings(project_id, last_reinforced_at, confidence);
CREATE INDEX idx_learnings_stage ON learnings(stage);
CREATE INDEX idx_mode_transitions_project ON mode_transitions(project_id);
CREATE INDEX idx_mode_transitions_time ON mode_transitions(transitioned_at DESC);
CREATE INDEX idx_msg_conv ON conversation_messages(conversation_id);
CREATE INDEX idx_msg_conv_idx ON conversation_messages(conversation_id, message_index);
CREATE INDEX idx_native_confidence ON native_knowledge (confidence);
CREATE INDEX idx_native_type ON native_knowledge (type);
CREATE INDEX idx_observations_frequency ON observations(frequency DESC);
CREATE INDEX idx_observations_last_seen ON observations(last_seen_at DESC);
CREATE INDEX idx_observations_project ON observations(project_id);
CREATE INDEX idx_observations_type ON observations(type);
CREATE INDEX idx_onboarding_project ON onboarding_contexts(project_id);
CREATE INDEX idx_ownership_author ON code_ownership(primary_author);
CREATE INDEX idx_ownership_project ON code_ownership(project_id);
CREATE INDEX idx_pattern_frequency ON pattern_instances(frequency DESC);
CREATE INDEX idx_pattern_project ON pattern_instances(project_id);
CREATE INDEX idx_pattern_status ON pattern_instances(status);
CREATE INDEX idx_pattern_type ON pattern_instances(pattern_type);
CREATE INDEX idx_pr_reviews_category ON pr_review_extracts(review_category);
CREATE INDEX idx_pr_reviews_project ON pr_review_extracts(project_id);
CREATE INDEX idx_profile_confidence ON developer_profile(confidence DESC);
CREATE INDEX idx_profile_project ON developer_profile(project_id);
CREATE INDEX idx_questions_priority ON open_questions(priority);
CREATE INDEX idx_questions_project ON open_questions(project_id);
CREATE INDEX idx_questions_status ON open_questions(status);
CREATE INDEX idx_reasoning_traces_outcome ON reasoning_traces(outcome);
CREATE INDEX idx_reasoning_traces_project ON reasoning_traces(project_id);
CREATE INDEX idx_reasoning_traces_session ON reasoning_traces(session_id);
CREATE INDEX idx_reflection_project ON reflection_questions(project_id);
CREATE INDEX idx_reflection_status ON reflection_questions(status);
CREATE INDEX idx_reflection_type ON reflection_questions(question_type);
CREATE INDEX idx_relationships_source ON relationships(source_type, source_id);
CREATE INDEX idx_relationships_target ON relationships(target_type, target_id);
CREATE INDEX idx_retrieval_fb_project ON retrieval_feedback(project_id);
CREATE INDEX idx_retrieval_fb_session ON retrieval_feedback(session_id);
CREATE INDEX idx_retrieval_fb_type ON retrieval_feedback(context_type);
CREATE INDEX idx_revert_events_original ON revert_events(original_commit_hash);
CREATE INDEX idx_revert_events_project ON revert_events(project_id);
CREATE INDEX idx_risk_alerts_active ON risk_alerts(project_id, dismissed);
CREATE INDEX idx_risk_alerts_project ON risk_alerts(project_id);
CREATE INDEX idx_routes_service ON routes (service_id);
CREATE INDEX idx_services_server ON services (server_id);
CREATE INDEX idx_session_learnings_session ON session_learnings(session_id);
CREATE INDEX idx_sessions_number ON sessions(project_id, session_number);
CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_sessions_task_type ON sessions(task_type);
CREATE INDEX idx_strategy_catalog_project ON strategy_catalog(project_id);
CREATE INDEX idx_strategy_catalog_success ON strategy_catalog(success_rate DESC);
CREATE INDEX idx_symbols_file ON symbols(file_id);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_type ON symbols(type);
CREATE INDEX idx_team_learnings_project ON team_learnings(project_id);
CREATE INDEX idx_test_results_commit ON test_results(commit_hash);
CREATE INDEX idx_test_results_project ON test_results(project_id);
CREATE INDEX idx_test_results_session ON test_results(session_id);
CREATE INDEX idx_test_source_project ON test_source_map(project_id);
CREATE INDEX idx_test_source_source ON test_source_map(source_file);
CREATE INDEX idx_test_source_test ON test_source_map(test_file);
CREATE INDEX idx_tool_calls_project ON tool_calls(project_id);
CREATE INDEX idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX idx_tool_calls_time ON tool_calls(created_at DESC);
CREATE INDEX idx_tool_calls_tool ON tool_calls(tool_name);
CREATE INDEX idx_value_metrics_project_month ON value_metrics(project_id, month);
CREATE INDEX idx_versions_learning ON learning_versions(learning_id, version DESC);
CREATE INDEX idx_work_queue_status ON work_queue(status, created_at);
CREATE INDEX idx_work_queue_type ON work_queue(job_type);
CREATE INDEX idx_workflow_pred_confidence ON workflow_predictions(confidence DESC);
CREATE INDEX idx_workflow_pred_project ON workflow_predictions(project_id);
CREATE INDEX idx_workflow_pred_trigger ON workflow_predictions(trigger_sequence);
CREATE INDEX idx_workflow_project ON workflow_patterns(project_id);
CREATE INDEX idx_workflow_task_type ON workflow_patterns(task_type);

-- ============================================================================
-- TRIGGERS (16)
-- ============================================================================

CREATE TRIGGER cognitive_events_ai AFTER INSERT ON cognitive_events BEGIN   INSERT INTO fts_cognitive_events(rowid, content, event_type, project)   VALUES (new.id, new.content, new.event_type, new.project); END;

CREATE TRIGGER conversation_messages_ad AFTER DELETE ON conversation_messages BEGIN INSERT INTO fts_conversation_messages(fts_conversation_messages, rowid, content) VALUES('delete', OLD.id, OLD.content); END;

CREATE TRIGGER conversation_messages_ai AFTER INSERT ON conversation_messages BEGIN INSERT INTO fts_conversation_messages(rowid, content) VALUES (NEW.id, NEW.content); END;

CREATE TRIGGER conversation_messages_au AFTER UPDATE ON conversation_messages BEGIN INSERT INTO fts_conversation_messages(fts_conversation_messages, rowid, content) VALUES('delete', OLD.id, OLD.content); INSERT INTO fts_conversation_messages(rowid, content) VALUES (NEW.id, NEW.content); END;

CREATE TRIGGER decisions_ai AFTER INSERT ON decisions BEGIN
INSERT INTO fts_decisions (rowid, title, decision, reasoning) VALUES (NEW.id, NEW.title, NEW.decision, NEW.reasoning);
END;

CREATE TRIGGER enrichment_metrics_cleanup AFTER INSERT ON enrichment_metrics BEGIN DELETE FROM enrichment_metrics WHERE id NOT IN ( SELECT id FROM enrichment_metrics ORDER BY created_at DESC LIMIT 10000 ); END;

CREATE TRIGGER error_log_cleanup AFTER INSERT ON _error_log BEGIN DELETE FROM _error_log WHERE id NOT IN ( SELECT id FROM _error_log ORDER BY timestamp DESC LIMIT 1000 ); END;

CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
DELETE FROM fts_files WHERE rowid = OLD.id;
END;

CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
INSERT INTO fts_files (rowid, path, purpose) VALUES (NEW.id, NEW.path, NEW.purpose);
END;

CREATE TRIGGER files_au AFTER UPDATE ON files BEGIN
DELETE FROM fts_files WHERE rowid = OLD.id;
INSERT INTO fts_files (rowid, path, purpose) VALUES (NEW.id, NEW.path, NEW.purpose);
END;

CREATE TRIGGER issues_ai AFTER INSERT ON issues BEGIN
        INSERT INTO fts_issues(rowid, title, description, workaround, resolution)
        VALUES (NEW.id, NEW.title, NEW.description, NEW.workaround, NEW.resolution);
      END;

CREATE TRIGGER learnings_ai AFTER INSERT ON learnings BEGIN
INSERT INTO fts_learnings (rowid, title, content, context) VALUES (NEW.id, NEW.title, NEW.content, NEW.context);
END;

CREATE TRIGGER pending_approvals_cleanup AFTER INSERT ON pending_approvals BEGIN DELETE FROM pending_approvals WHERE expires_at IS NOT NULL AND expires_at < datetime('now'); END;

CREATE TRIGGER symbols_ai AFTER INSERT ON symbols BEGIN
INSERT INTO fts_symbols (rowid, name, purpose) VALUES (NEW.id, NEW.name, NEW.purpose);
END;

CREATE TRIGGER tool_calls_cleanup AFTER INSERT ON tool_calls BEGIN DELETE FROM tool_calls WHERE project_id = NEW.project_id AND id NOT IN ( SELECT id FROM tool_calls WHERE project_id = NEW.project_id ORDER BY created_at DESC LIMIT 5000 ); END;

CREATE TRIGGER work_queue_cleanup AFTER INSERT ON work_queue BEGIN DELETE FROM work_queue WHERE (status = 'completed' AND completed_at < datetime('now', '-7 days')) OR (status = 'failed' AND completed_at < datetime('now', '-30 days')); END;

-- ============================================================================
-- FTS5 VIRTUAL TABLES (11)
-- ============================================================================

CREATE VIRTUAL TABLE fts_cognitive_events USING fts5(content, event_type, project, content=cognitive_events, content_rowid=id);

CREATE VIRTUAL TABLE fts_conversation_messages USING fts5( content, content='conversation_messages', content_rowid='id' );

CREATE VIRTUAL TABLE fts_decisions USING fts5 (title, decision, reasoning);

CREATE VIRTUAL TABLE fts_files USING fts5 (path, purpose, type);

CREATE VIRTUAL TABLE fts_global_learnings USING fts5 (title, content, context);

CREATE VIRTUAL TABLE fts_issues USING fts5(title, description, workaround, resolution);

CREATE VIRTUAL TABLE fts_learnings USING fts5 (title, content, context);

CREATE VIRTUAL TABLE fts_observations USING fts5( content, type );

CREATE VIRTUAL TABLE fts_patterns USING fts5 (name, description, code_example);

CREATE VIRTUAL TABLE fts_questions USING fts5( question, context );

CREATE VIRTUAL TABLE fts_symbols USING fts5 (name, purpose, content_rowid=id);
