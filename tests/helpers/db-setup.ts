/**
 * Test database setup utilities
 * Provides helpers to create temporary databases with test data
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestDb {
  db: Database;
  path: string;
  projectId: number;
  tempDir: string;
  cleanup: () => void;
}

/**
 * Create a test database with minimal schema
 */
export function createTestDb(): TestDb {
  const tempDir = mkdtempSync(join(tmpdir(), "muninn-test-"));
  const dbPath = join(tempDir, "test.db");
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  // Create core tables
  db.exec(`
    -- Projects
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      stack TEXT,
      status TEXT DEFAULT 'active',
      mode TEXT DEFAULT 'exploring',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Files
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      type TEXT,
      purpose TEXT,
      exports TEXT,
      dependencies TEXT,
      dependents TEXT,
      fragility INTEGER DEFAULT 0,
      fragility_reason TEXT,
      status TEXT DEFAULT 'active',
      last_modified TEXT,
      last_analyzed TEXT,
      embedding BLOB,
      content_hash TEXT,
      fs_modified_at TEXT,
      last_queried_at TEXT,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      velocity_score REAL DEFAULT 0.0,
      change_count INTEGER DEFAULT 0,
      first_changed_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, path)
    );
    CREATE INDEX idx_files_project ON files(project_id);
    CREATE INDEX idx_files_fragility ON files(fragility);

    -- Symbols
    CREATE TABLE symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      signature TEXT,
      purpose TEXT,
      parameters TEXT,
      returns TEXT,
      side_effects TEXT,
      callers TEXT,
      calls TEXT,
      complexity INTEGER DEFAULT 0,
      embedding BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_symbols_file ON symbols(file_id);
    CREATE INDEX idx_symbols_name ON symbols(name);

    -- Decisions
    CREATE TABLE decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      decision TEXT NOT NULL,
      reasoning TEXT,
      alternatives TEXT,
      consequences TEXT,
      affects TEXT,
      status TEXT DEFAULT 'active',
      superseded_by INTEGER,
      invariant TEXT,
      constraint_type TEXT DEFAULT 'should_hold',
      decided_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      outcome_status TEXT DEFAULT 'pending',
      outcome_notes TEXT,
      outcome_at TEXT,
      check_after_sessions INTEGER DEFAULT 5,
      sessions_since INTEGER DEFAULT 0,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_decisions_project ON decisions(project_id);
    CREATE INDEX idx_decisions_status ON decisions(status);

    -- Issues
    CREATE TABLE issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'bug',
      severity INTEGER DEFAULT 5,
      status TEXT DEFAULT 'open',
      affected_files TEXT,
      related_symbols TEXT,
      workaround TEXT,
      resolution TEXT,
      resolved_at TEXT,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_issues_project ON issues(project_id);
    CREATE INDEX idx_issues_status ON issues(status);
    CREATE INDEX idx_issues_severity ON issues(severity);

    -- Sessions
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      goal TEXT,
      outcome TEXT,
      files_touched TEXT,
      files_read TEXT,
      patterns_used TEXT,
      queries_made TEXT,
      decisions_made TEXT,
      issues_found TEXT,
      issues_resolved TEXT,
      learnings TEXT,
      next_steps TEXT,
      success INTEGER,
      session_number INTEGER
    );
    CREATE INDEX idx_sessions_project ON sessions(project_id);

    -- Learnings
    CREATE TABLE learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      source TEXT,
      confidence INTEGER DEFAULT 5,
      times_applied INTEGER DEFAULT 0,
      last_applied TEXT,
      embedding BLOB,
      temperature TEXT DEFAULT 'cold',
      last_referenced_at TEXT,
      archived_at TEXT,
      consolidated_into INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_learnings_project ON learnings(project_id);
    CREATE INDEX idx_learnings_category ON learnings(category);

    -- Focus (working memory)
    CREATE TABLE focus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
      area TEXT NOT NULL,
      description TEXT,
      files TEXT,
      keywords TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      cleared_at TEXT
    );
    CREATE INDEX idx_focus_project ON focus(project_id);

    -- Observations
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT DEFAULT 'insight',
      content TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      embedding BLOB,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_observations_project ON observations(project_id);
    CREATE INDEX idx_observations_type ON observations(type);

    -- Open Questions
    CREATE TABLE open_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      context TEXT,
      priority INTEGER DEFAULT 3,
      status TEXT DEFAULT 'open',
      resolution TEXT,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      embedding BLOB,
      resolved_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_questions_project ON open_questions(project_id);
    CREATE INDEX idx_questions_status ON open_questions(status);

    -- Relationships
    CREATE TABLE relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      relationship TEXT NOT NULL,
      strength INTEGER DEFAULT 5,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_relationships_unique ON relationships(source_type, source_id, target_type, target_id, relationship);

    -- Global Learnings
    CREATE TABLE global_learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      source_project TEXT,
      confidence INTEGER DEFAULT 5,
      times_applied INTEGER DEFAULT 0,
      last_applied TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Patterns
    CREATE TABLE patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      code_example TEXT,
      anti_pattern TEXT,
      applies_to TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tech Debt
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

    -- Infrastructure tables
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
      last_seen TEXT,
      last_health_check TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      last_health_check TEXT,
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
    CREATE INDEX idx_services_server ON services(server_id);

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_routes_service ON routes(service_id);

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
    CREATE INDEX idx_service_deps_service ON service_deps(service_id);

    -- FTS5 virtual tables
    CREATE VIRTUAL TABLE fts_files USING fts5(path, purpose, content='files', content_rowid='id');
    CREATE VIRTUAL TABLE fts_decisions USING fts5(title, decision, reasoning, content='decisions', content_rowid='id');
    CREATE VIRTUAL TABLE fts_issues USING fts5(title, description, workaround, content='issues', content_rowid='id');
    CREATE VIRTUAL TABLE fts_learnings USING fts5(title, content, context, content='learnings', content_rowid='id');
    CREATE VIRTUAL TABLE fts_symbols USING fts5(name, signature, purpose, content='symbols', content_rowid='id');
    CREATE VIRTUAL TABLE fts_observations USING fts5(content, content='observations', content_rowid='id');
    CREATE VIRTUAL TABLE fts_questions USING fts5(question, context, content='open_questions', content_rowid='id');
    CREATE VIRTUAL TABLE fts_global_learnings USING fts5(title, content, context, content='global_learnings', content_rowid='id');
    CREATE VIRTUAL TABLE fts_patterns USING fts5(name, description, code_example, content='patterns', content_rowid='id');
  `);

  // Seed test project
  const result = db.run(
    `INSERT INTO projects (path, name, type, stack) VALUES (?, ?, ?, ?)`,
    [tempDir, "Test Project", "cli", '["TypeScript", "Bun"]']
  );
  const projectId = Number(result.lastInsertRowid);

  return {
    db,
    path: dbPath,
    projectId,
    tempDir,
    cleanup: () => {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

/**
 * Seed test files into the database
 */
export function seedTestFiles(
  db: Database,
  projectId: number,
  files: Array<{ path: string; purpose?: string; fragility?: number }>
): number[] {
  const ids: number[] = [];
  for (const file of files) {
    const result = db.run(
      `INSERT INTO files (project_id, path, purpose, fragility) VALUES (?, ?, ?, ?)`,
      [projectId, file.path, file.purpose ?? null, file.fragility ?? 0]
    );
    ids.push(Number(result.lastInsertRowid));

    // Update FTS
    db.run(`INSERT INTO fts_files(rowid, path, purpose) VALUES (?, ?, ?)`, [
      result.lastInsertRowid,
      file.path,
      file.purpose ?? null,
    ]);
  }
  return ids;
}

/**
 * Seed test decisions into the database
 */
export function seedTestDecisions(
  db: Database,
  projectId: number,
  decisions: Array<{ title: string; decision: string; reasoning?: string }>
): number[] {
  const ids: number[] = [];
  for (const dec of decisions) {
    const result = db.run(
      `INSERT INTO decisions (project_id, title, decision, reasoning) VALUES (?, ?, ?, ?)`,
      [projectId, dec.title, dec.decision, dec.reasoning ?? null]
    );
    ids.push(Number(result.lastInsertRowid));

    // Update FTS
    db.run(
      `INSERT INTO fts_decisions(rowid, title, decision, reasoning) VALUES (?, ?, ?, ?)`,
      [result.lastInsertRowid, dec.title, dec.decision, dec.reasoning ?? null]
    );
  }
  return ids;
}

/**
 * Seed test issues into the database
 */
export function seedTestIssues(
  db: Database,
  projectId: number,
  issues: Array<{ title: string; description?: string; severity?: number }>
): number[] {
  const ids: number[] = [];
  for (const issue of issues) {
    const result = db.run(
      `INSERT INTO issues (project_id, title, description, severity) VALUES (?, ?, ?, ?)`,
      [projectId, issue.title, issue.description ?? null, issue.severity ?? 5]
    );
    ids.push(Number(result.lastInsertRowid));

    // Update FTS
    db.run(
      `INSERT INTO fts_issues(rowid, title, description, workaround) VALUES (?, ?, ?, ?)`,
      [result.lastInsertRowid, issue.title, issue.description ?? null, null]
    );
  }
  return ids;
}

/**
 * Seed test learnings into the database
 */
export function seedTestLearnings(
  db: Database,
  projectId: number | null,
  learnings: Array<{ category: string; title: string; content: string; context?: string }>
): number[] {
  const ids: number[] = [];
  for (const learning of learnings) {
    const result = db.run(
      `INSERT INTO learnings (project_id, category, title, content, context) VALUES (?, ?, ?, ?, ?)`,
      [projectId, learning.category, learning.title, learning.content, learning.context ?? null]
    );
    ids.push(Number(result.lastInsertRowid));

    // Update FTS
    db.run(
      `INSERT INTO fts_learnings(rowid, title, content, context) VALUES (?, ?, ?, ?)`,
      [result.lastInsertRowid, learning.title, learning.content, learning.context ?? null]
    );
  }
  return ids;
}

/**
 * Set focus for a project
 */
export function setTestFocus(
  db: Database,
  projectId: number,
  area: string,
  files: string[] = [],
  keywords: string[] = []
): number {
  const result = db.run(
    `INSERT INTO focus (project_id, area, files, keywords) VALUES (?, ?, ?, ?)`,
    [projectId, area, JSON.stringify(files), JSON.stringify(keywords)]
  );
  return Number(result.lastInsertRowid);
}

/**
 * Seed test servers
 */
export function seedTestServers(
  db: Database,
  servers: Array<{ name: string; role?: string; status?: string }>
): number[] {
  const ids: number[] = [];
  for (const server of servers) {
    const result = db.run(
      `INSERT INTO servers (name, role, status) VALUES (?, ?, ?)`,
      [server.name, server.role ?? null, server.status ?? "unknown"]
    );
    ids.push(Number(result.lastInsertRowid));
  }
  return ids;
}

/**
 * Seed test services
 */
export function seedTestServices(
  db: Database,
  services: Array<{ name: string; serverId: number; port?: number; healthStatus?: string }>
): number[] {
  const ids: number[] = [];
  for (const service of services) {
    const result = db.run(
      `INSERT INTO services (name, server_id, port, health_status) VALUES (?, ?, ?, ?)`,
      [service.name, service.serverId, service.port ?? null, service.healthStatus ?? "unknown"]
    );
    ids.push(Number(result.lastInsertRowid));
  }
  return ids;
}
