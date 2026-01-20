-- Claude Context Memory System
-- SQLite database schema
-- Location: ~/.claude/memory.db (global) or .claude/memory.db (per-project)

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Projects Claude has worked on
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,              -- /home/user/projects/myapp
    name TEXT NOT NULL,                     -- myapp
    type TEXT,                              -- web-app, api, cli, library, monorepo
    stack TEXT,                             -- JSON array: ["sveltekit", "typescript", "drizzle"]
    status TEXT DEFAULT 'active',           -- active, maintenance, archived
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Files Claude knows about
CREATE TABLE IF NOT EXISTS files (
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
    content_hash TEXT,                      -- SHA256 of file content for staleness detection
    fs_modified_at TEXT,                    -- Filesystem mtime for staleness detection
    last_queried_at TEXT,                   -- When this file was last queried (for conflict detection)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, path)
);

-- Functions/Components Claude has learned about
CREATE TABLE IF NOT EXISTS symbols (
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

-- Architectural decisions
CREATE TABLE IF NOT EXISTS decisions (
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
);

-- Known issues and technical debt
CREATE TABLE IF NOT EXISTS issues (
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
);

-- Work sessions
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    goal TEXT,                              -- What we set out to do
    outcome TEXT,                           -- What actually happened
    files_touched TEXT,                     -- JSON array of modified files
    files_read TEXT,                        -- JSON array of files read during session
    patterns_used TEXT,                     -- JSON array of patterns applied
    queries_made TEXT,                      -- JSON array of searches performed
    decisions_made TEXT,                    -- JSON array of decision IDs
    issues_found TEXT,                      -- JSON array of issue IDs
    issues_resolved TEXT,                   -- JSON array of issue IDs
    learnings TEXT,                         -- What Claude learned
    next_steps TEXT,                        -- What should happen next
    success INTEGER                         -- 0 = failed, 1 = partial, 2 = success
);

-- Learnings and patterns
CREATE TABLE IF NOT EXISTS learnings (
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
);

-- Relationships between entities
CREATE TABLE IF NOT EXISTS relationships (
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

-- ============================================================================
-- INDEXES FOR FAST QUERIES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
CREATE INDEX IF NOT EXISTS idx_files_fragility ON files(fragility);

CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(type);
CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project_id);
CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);

CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_type, target_id);

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Current project state
CREATE VIEW IF NOT EXISTS v_project_state AS
SELECT 
    p.*,
    (SELECT COUNT(*) FROM files WHERE project_id = p.id) as file_count,
    (SELECT COUNT(*) FROM issues WHERE project_id = p.id AND status = 'open') as open_issues,
    (SELECT COUNT(*) FROM decisions WHERE project_id = p.id AND status = 'active') as active_decisions,
    (SELECT goal FROM sessions WHERE project_id = p.id ORDER BY started_at DESC LIMIT 1) as last_goal,
    (SELECT next_steps FROM sessions WHERE project_id = p.id ORDER BY started_at DESC LIMIT 1) as pending_next_steps
FROM projects p;

-- Fragile files that need careful handling
CREATE VIEW IF NOT EXISTS v_fragile_files AS
SELECT 
    f.*,
    p.name as project_name,
    p.path as project_path
FROM files f
JOIN projects p ON f.project_id = p.id
WHERE f.fragility >= 7 OR f.status = 'do-not-touch'
ORDER BY f.fragility DESC;

-- Recent activity
CREATE VIEW IF NOT EXISTS v_recent_activity AS
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
LIMIT 50;

-- ============================================================================
-- FULL-TEXT SEARCH (SQLite FTS5)
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS fts_files USING fts5(
    path,
    purpose,
    content_rowid=id
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_symbols USING fts5(
    name,
    purpose,
    content_rowid=id
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_decisions USING fts5(
    title,
    decision,
    reasoning,
    content_rowid=id
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_issues USING fts5(
    title,
    description,
    workaround,
    resolution,
    content_rowid=id
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_learnings USING fts5(
    title,
    content,
    context,
    content_rowid=id
);

-- ============================================================================
-- TRIGGERS TO KEEP FTS IN SYNC
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
    INSERT INTO fts_files(rowid, path, purpose) VALUES (NEW.id, NEW.path, NEW.purpose);
END;

CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
    DELETE FROM fts_files WHERE rowid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
    DELETE FROM fts_files WHERE rowid = OLD.id;
    INSERT INTO fts_files(rowid, path, purpose) VALUES (NEW.id, NEW.path, NEW.purpose);
END;

-- Similar triggers for other tables...
CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
    INSERT INTO fts_symbols(rowid, name, purpose) VALUES (NEW.id, NEW.name, NEW.purpose);
END;

CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
    INSERT INTO fts_decisions(rowid, title, decision, reasoning) 
    VALUES (NEW.id, NEW.title, NEW.decision, NEW.reasoning);
END;

CREATE TRIGGER IF NOT EXISTS issues_ai AFTER INSERT ON issues BEGIN
    INSERT INTO fts_issues(rowid, title, description, workaround, resolution)
    VALUES (NEW.id, NEW.title, NEW.description, NEW.workaround, NEW.resolution);
END;

CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
    INSERT INTO fts_learnings(rowid, title, content, context)
    VALUES (NEW.id, NEW.title, NEW.content, NEW.context);
END;

-- ============================================================================
-- SECURITY TABLES
-- ============================================================================

-- Security findings from scans
CREATE TABLE IF NOT EXISTS security_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    finding_type TEXT NOT NULL,           -- sql_injection, xss, hardcoded_secret, etc.
    severity TEXT NOT NULL,               -- critical, high, medium, low
    line_number INTEGER,
    code_snippet TEXT,
    description TEXT NOT NULL,
    recommendation TEXT,
    status TEXT DEFAULT 'open',           -- open, resolved, false_positive
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_findings_project ON security_findings(project_id);
CREATE INDEX IF NOT EXISTS idx_security_findings_severity ON security_findings(severity);
CREATE INDEX IF NOT EXISTS idx_security_findings_status ON security_findings(status);

-- Dependency vulnerabilities
CREATE TABLE IF NOT EXISTS dependency_vulnerabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    package_name TEXT NOT NULL,
    current_version TEXT,
    vulnerable_versions TEXT,
    severity TEXT NOT NULL,               -- critical, high, medium, low
    cve_id TEXT,
    description TEXT,
    recommendation TEXT,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dep_vuln_project ON dependency_vulnerabilities(project_id);

-- ============================================================================
-- QUALITY TABLES
-- ============================================================================

-- Quality metrics per file
CREATE TABLE IF NOT EXISTS quality_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    cyclomatic_complexity INTEGER,
    max_function_length INTEGER,
    function_count INTEGER,
    any_type_count INTEGER,               -- Number of 'any' types
    ts_ignore_count INTEGER,              -- Number of @ts-ignore
    todo_count INTEGER,
    test_coverage REAL,                   -- 0-100
    lint_errors INTEGER,
    lint_warnings INTEGER,
    overall_score REAL,                   -- 0-10
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_quality_project ON quality_metrics(project_id);

-- ============================================================================
-- PERFORMANCE TABLES
-- ============================================================================

-- Performance findings
CREATE TABLE IF NOT EXISTS performance_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    finding_type TEXT NOT NULL,           -- n_plus_one, sync_in_hot_path, memory_leak, etc.
    severity TEXT NOT NULL,
    line_number INTEGER,
    code_snippet TEXT,
    description TEXT NOT NULL,
    recommendation TEXT,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_perf_findings_project ON performance_findings(project_id);

-- ============================================================================
-- INFRASTRUCTURE TABLES (Global - for cross-server awareness)
-- ============================================================================

-- Servers in the infrastructure
CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,               -- myserver, node1, hetzner
    hostname TEXT,                           -- actual hostname
    ip_addresses TEXT,                       -- JSON array: ["192.168.1.10", "10.0.0.1"]
    role TEXT,                               -- production, staging, development, homelab
    ssh_user TEXT DEFAULT 'root',
    ssh_port INTEGER DEFAULT 22,
    ssh_key_path TEXT,                       -- ~/.ssh/id_ed25519
    ssh_jump_host TEXT,                      -- bastion server name if needed
    os TEXT,                                 -- ubuntu-24.04, debian-12
    resources TEXT,                          -- JSON: {cpu: 8, ram: "32GB", disk: "1TB"}
    tags TEXT,                               -- JSON array: ["docker", "k8s", "gpu"]
    status TEXT DEFAULT 'unknown',           -- online, offline, degraded, unknown
    last_seen DATETIME,
    last_health_check DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Services running on servers
CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                      -- api, web, worker, postgres, redis
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    type TEXT,                               -- app, database, cache, queue, proxy, static
    runtime TEXT,                            -- bun, node, go, docker, systemd, pm2
    port INTEGER,
    health_endpoint TEXT,                    -- /health, /api/health
    health_status TEXT DEFAULT 'unknown',    -- healthy, unhealthy, degraded, unknown
    last_health_check DATETIME,
    response_time_ms INTEGER,                -- last health check response time
    config TEXT,                             -- JSON: service-specific config
    env_file TEXT,                           -- path to .env file on server
    project_path TEXT,                       -- /home/user/apps/myapi
    git_repo TEXT,                           -- git@github.com:user/repo
    git_branch TEXT DEFAULT 'main',
    current_version TEXT,                    -- git sha or semver
    deploy_command TEXT,                     -- "cd /app && git pull && bun run build && pm2 restart api"
    restart_command TEXT,                    -- "systemctl restart myapp" or "pm2 restart api"
    stop_command TEXT,                       -- "pm2 stop api"
    log_command TEXT,                        -- "pm2 logs api --lines 100" or "journalctl -u myapp -n 100"
    status TEXT DEFAULT 'unknown',           -- running, stopped, error, unknown
    auto_restart INTEGER DEFAULT 1,          -- whether service auto-restarts
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, name)
);

-- Routes / Ingress (domains pointing to services)
CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,                    -- api.example.com
    path TEXT DEFAULT '/',                   -- /api/v1, /
    service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
    method TEXT DEFAULT '*',                 -- GET, POST, *, etc.
    proxy_type TEXT,                         -- nginx, caddy, cloudflare, traefik, direct
    ssl_type TEXT,                           -- letsencrypt, cloudflare, self-signed, none
    rate_limit TEXT,                         -- JSON: {requests: 100, window: "1m"}
    auth_required INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(domain, path, method)
);

-- Service dependencies (what depends on what)
CREATE TABLE IF NOT EXISTS service_deps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    depends_on_service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
    depends_on_external TEXT,                -- external service name if not in our infra (e.g., "stripe", "sendgrid")
    dependency_type TEXT,                    -- database, cache, api, queue, auth, storage
    connection_env_var TEXT,                 -- DATABASE_URL, REDIS_URL, API_KEY
    required INTEGER DEFAULT 1,              -- 1 = hard dependency, 0 = optional/graceful degradation
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(service_id, COALESCE(depends_on_service_id, -1), COALESCE(depends_on_external, ''))
);

-- Deployment history
CREATE TABLE IF NOT EXISTS deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    version TEXT NOT NULL,                   -- git sha or semver
    previous_version TEXT,
    deployed_by TEXT,                    -- deploy, ci, claude
    deploy_method TEXT,                      -- manual, git-pull, docker, ci
    status TEXT DEFAULT 'pending',           -- pending, in_progress, success, failed, rolled_back
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    duration_seconds INTEGER,
    output TEXT,                             -- deployment output/logs
    error TEXT,                              -- error message if failed
    rollback_version TEXT,                   -- if rolled back, to what version
    notes TEXT
);

-- Infrastructure events (audit log)
CREATE TABLE IF NOT EXISTS infra_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,                -- deploy, restart, health_change, alert, incident, ssh, config_change
    severity TEXT DEFAULT 'info',            -- info, warning, error, critical
    title TEXT NOT NULL,
    description TEXT,
    metadata TEXT,                           -- JSON: additional context
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Secrets registry (metadata only - never store actual secrets!)
CREATE TABLE IF NOT EXISTS secrets_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                      -- DATABASE_URL, STRIPE_SECRET_KEY
    service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    secret_manager TEXT,                     -- env_file, 1password, vault, doppler, manual
    vault_path TEXT,                         -- path in secret manager (not the secret itself!)
    last_rotated DATETIME,
    rotation_days INTEGER,                   -- rotate every N days (NULL = no rotation)
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, COALESCE(service_id, -1), COALESCE(server_id, -1))
);

-- Infrastructure indexes
CREATE INDEX IF NOT EXISTS idx_services_server ON services(server_id);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_routes_service ON routes(service_id);
CREATE INDEX IF NOT EXISTS idx_routes_domain ON routes(domain);
CREATE INDEX IF NOT EXISTS idx_service_deps_service ON service_deps(service_id);
CREATE INDEX IF NOT EXISTS idx_service_deps_depends ON service_deps(depends_on_service_id);
CREATE INDEX IF NOT EXISTS idx_deployments_service ON deployments(service_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_infra_events_server ON infra_events(server_id);
CREATE INDEX IF NOT EXISTS idx_infra_events_service ON infra_events(service_id);
CREATE INDEX IF NOT EXISTS idx_infra_events_type ON infra_events(event_type);
CREATE INDEX IF NOT EXISTS idx_secrets_service ON secrets_registry(service_id);

-- Additional performance indexes (added in refactor)
CREATE INDEX IF NOT EXISTS idx_files_project_fragility ON files(project_id, fragility);
CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);
CREATE INDEX IF NOT EXISTS idx_decisions_project_status ON decisions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_relationships_lookup ON relationships(source_type, source_id, target_type);
CREATE INDEX IF NOT EXISTS idx_services_health ON services(health_status, server_id);
CREATE INDEX IF NOT EXISTS idx_deployments_service_time ON deployments(service_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project_time ON sessions(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_applied ON learnings(times_applied DESC, confidence DESC);

-- View: Full infrastructure status
CREATE VIEW IF NOT EXISTS v_infra_status AS
SELECT
    s.id as server_id,
    s.name as server_name,
    s.status as server_status,
    s.last_seen,
    sv.id as service_id,
    sv.name as service_name,
    sv.type as service_type,
    sv.port,
    sv.health_status,
    sv.status as service_status,
    sv.current_version,
    (SELECT domain FROM routes WHERE service_id = sv.id LIMIT 1) as primary_domain
FROM servers s
LEFT JOIN services sv ON sv.server_id = s.id
ORDER BY s.name, sv.name;

-- View: Service dependency graph
CREATE VIEW IF NOT EXISTS v_service_deps AS
SELECT
    s1.name as service_name,
    s1.server_id,
    srv1.name as server_name,
    COALESCE(s2.name, sd.depends_on_external) as depends_on,
    CASE WHEN s2.id IS NOT NULL THEN srv2.name ELSE 'external' END as depends_on_server,
    sd.dependency_type,
    sd.required
FROM service_deps sd
JOIN services s1 ON sd.service_id = s1.id
JOIN servers srv1 ON s1.server_id = srv1.id
LEFT JOIN services s2 ON sd.depends_on_service_id = s2.id
LEFT JOIN servers srv2 ON s2.server_id = srv2.id;

-- ============================================================================
-- SESSION WORKING MEMORY TABLES
-- ============================================================================

-- Bookmarks: Session-scoped working memory for Claude
-- Allows Claude to "set aside" context and recall it later without keeping it in context window
CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,                    -- "auth pattern", "db schema", etc.
    content TEXT NOT NULL,                  -- The bookmarked content
    source TEXT,                            -- "file:path:lines" or "decision:id" etc.
    content_type TEXT DEFAULT 'text',       -- text, code, json, markdown
    priority INTEGER DEFAULT 3,             -- 1-5, for sorting (1 = highest)
    tags TEXT,                              -- JSON array of tags for filtering
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,                    -- Optional auto-expiry
    UNIQUE(project_id, label)               -- One bookmark per label per project
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_session ON bookmarks(session_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_project ON bookmarks(project_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_label ON bookmarks(label);
CREATE INDEX IF NOT EXISTS idx_bookmarks_priority ON bookmarks(priority);

-- Focus: Tell Claude what area you're working in
-- Queries automatically prioritize results from the focus area
CREATE TABLE IF NOT EXISTS focus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    area TEXT NOT NULL,                     -- "authentication", "api/v2", "database layer"
    description TEXT,                       -- Optional description of what you're doing
    files TEXT,                             -- JSON array of file patterns to prioritize
    keywords TEXT,                          -- JSON array of keywords to boost
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    cleared_at DATETIME,                    -- When focus was cleared
    UNIQUE(project_id, session_id)          -- One focus per session per project
);

CREATE INDEX IF NOT EXISTS idx_focus_project ON focus(project_id);
CREATE INDEX IF NOT EXISTS idx_focus_session ON focus(session_id);
CREATE INDEX IF NOT EXISTS idx_focus_area ON focus(area);
