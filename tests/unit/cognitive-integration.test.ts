/**
 * Tests for v46 cognitive integration — Huginn tables in Muninn.
 *
 * Uses direct SQL schema creation rather than full migration runner,
 * since the migration runner validates against project state that
 * doesn't exist in a memory-only test database.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";

let db: Database;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL
  );

  INSERT INTO projects (name, path) VALUES ('test-project', '/tmp/test');

  CREATE TABLE IF NOT EXISTS cognitive_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    event_type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    neuro_snapshot TEXT DEFAULT '{}',
    source TEXT DEFAULT 'huginn',
    project TEXT DEFAULT '',
    created_at REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cog_events_type ON cognitive_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_cog_events_created ON cognitive_events(created_at DESC);

  CREATE VIRTUAL TABLE IF NOT EXISTS fts_cognitive_events
    USING fts5(content, event_type, source, content=cognitive_events, content_rowid=id);

  CREATE TRIGGER IF NOT EXISTS cognitive_events_fts_ai AFTER INSERT ON cognitive_events BEGIN
    INSERT INTO fts_cognitive_events(rowid, content, event_type, source)
    VALUES (new.id, new.content, new.event_type, new.source);
  END;

  CREATE TABLE IF NOT EXISTS beliefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    topic TEXT NOT NULL,
    conclusion TEXT NOT NULL,
    evidence TEXT DEFAULT '[]',
    confidence REAL DEFAULT 0.8,
    source TEXT DEFAULT 'musing',
    status TEXT DEFAULT 'settled',
    competing_hypothesis TEXT DEFAULT '',
    labile_until REAL DEFAULT 0.0,
    concluded_at REAL NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_beliefs_topic ON beliefs(topic);

  CREATE VIRTUAL TABLE IF NOT EXISTS fts_beliefs
    USING fts5(topic, conclusion, competing_hypothesis, content=beliefs, content_rowid=id);

  CREATE TRIGGER IF NOT EXISTS beliefs_fts_ai AFTER INSERT ON beliefs BEGIN
    INSERT INTO fts_beliefs(rowid, topic, conclusion, competing_hypothesis)
    VALUES (new.id, new.topic, new.conclusion, new.competing_hypothesis);
  END;

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    claim TEXT NOT NULL,
    source TEXT DEFAULT 'huginn',
    confidence REAL DEFAULT 0.5,
    made_at REAL NOT NULL,
    expected_by REAL,
    status TEXT DEFAULT 'pending',
    resolution_notes TEXT,
    resolved_at REAL,
    surprise_on_resolution REAL
  );
`;

beforeAll(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
});

afterAll(() => {
  db.close();
});

describe("Cognitive Integration Tables", () => {
  test("cognitive_events table has expected columns", () => {
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(cognitive_events)")
      .all()
      .map((c) => c.name);

    expect(cols).toContain("project_id");
    expect(cols).toContain("neuro_snapshot");
    expect(cols).toContain("source");
    expect(cols).toContain("event_type");
    expect(cols).toContain("content");
    expect(cols).toContain("created_at");
  });

  test("beliefs table has expected columns", () => {
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(beliefs)")
      .all()
      .map((c) => c.name);

    expect(cols).toContain("topic");
    expect(cols).toContain("conclusion");
    expect(cols).toContain("evidence");
    expect(cols).toContain("confidence");
    expect(cols).toContain("competing_hypothesis");
    expect(cols).toContain("labile_until");
  });

  test("predictions table has expected columns", () => {
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(predictions)")
      .all()
      .map((c) => c.name);

    expect(cols).toContain("claim");
    expect(cols).toContain("confidence");
    expect(cols).toContain("status");
    expect(cols).toContain("surprise_on_resolution");
  });

  test("can insert and FTS-search cognitive events", () => {
    db.run(
      `INSERT INTO cognitive_events (event_type, content, neuro_snapshot, source, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["musing", "Deep analysis of portfolio revenue trends", '{"dopamine":0.5}', "huginn", Date.now() / 1000],
    );

    const rows = db
      .query<{ content: string }, []>(
        `SELECT ce.content FROM fts_cognitive_events
         JOIN cognitive_events ce ON fts_cognitive_events.rowid = ce.id
         WHERE fts_cognitive_events MATCH 'revenue'`,
      )
      .all();

    expect(rows.length).toBe(1);
    expect(rows[0].content).toContain("revenue");
  });

  test("can insert and FTS-search beliefs", () => {
    db.run(
      `INSERT INTO beliefs (topic, conclusion, evidence, confidence, source, status, concluded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["acme-payments", "Payment integration is the primary blocker", '["analysis"]', 0.85, "musing", "settled", Date.now() / 1000],
    );

    const rows = db
      .query<{ topic: string }, []>(
        `SELECT b.topic FROM fts_beliefs
         JOIN beliefs b ON fts_beliefs.rowid = b.id
         WHERE fts_beliefs MATCH 'payment'`,
      )
      .all();

    expect(rows.length).toBe(1);
    expect(rows[0].topic).toBe("acme-payments");
  });

  test("beliefs upsert via ON CONFLICT works", () => {
    db.run(
      `INSERT INTO beliefs (topic, conclusion, confidence, source, status, concluded_at)
       VALUES ('upsert-test', 'first', 0.7, 'musing', 'settled', 0)`,
    );
    db.run(
      `INSERT INTO beliefs (topic, conclusion, confidence, source, status, concluded_at)
       VALUES ('upsert-test', 'updated', 0.9, 'conversation', 'settled', 1)
       ON CONFLICT(topic) DO UPDATE SET conclusion=excluded.conclusion, confidence=excluded.confidence`,
    );

    const row = db
      .query<{ conclusion: string; confidence: number }, []>(
        "SELECT conclusion, confidence FROM beliefs WHERE topic = 'upsert-test'",
      )
      .get();

    expect(row!.conclusion).toBe("updated");
    expect(row!.confidence).toBe(0.9);
  });

  test("predictions lifecycle: create -> resolve", () => {
    db.run(
      `INSERT INTO predictions (claim, source, confidence, status, made_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["project will have paying users by Q2", "huginn", 0.6, "pending", Date.now() / 1000],
    );

    const pending = db
      .query<{ id: number }, []>("SELECT id FROM predictions WHERE status = 'pending' ORDER BY id DESC LIMIT 1")
      .get();
    expect(pending).not.toBeNull();
    const predId = pending!.id;

    db.run(
      "UPDATE predictions SET status = 'confirmed', resolved_at = ?, resolution_notes = ?, surprise_on_resolution = ? WHERE id = ?",
      [Date.now() / 1000, "First customer", 0.3, predId],
    );

    const resolved = db
      .query<{ status: string; surprise_on_resolution: number }, []>(
        `SELECT status, surprise_on_resolution FROM predictions WHERE id = ${predId}`,
      )
      .get();

    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe("confirmed");
    expect(resolved!.surprise_on_resolution).toBe(0.3);
  });
});
