/**
 * Session commands integration tests
 * Tests session start, end, list, and resume functionality
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "../helpers/db-setup";

describe("Session Start", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import session module", async () => {
    const session = await import("../../src/commands/session");
    expect(typeof session.sessionStart).toBe("function");
    expect(typeof session.sessionEnd).toBe("function");
    expect(typeof session.sessionLast).toBe("function");
  });

  test("creates session with goal", async () => {
    const { sessionStart } = await import("../../src/commands/session");

    // Suppress output
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    const sessionId = await sessionStart(testDb.db, testDb.projectId, "Test goal");

    console.log = originalLog;
    console.error = originalError;

    expect(sessionId).toBeGreaterThan(0);

    // Verify in database (use rawDb for direct SQL)
    const session = testDb.rawDb
      .query<{ id: number; goal: string }, [number]>(`SELECT id, goal FROM sessions WHERE id = ?`)
      .get(sessionId);

    expect(session?.goal).toBe("Test goal");
    expect(session?.id).toBe(sessionId);
  });

  test("session has started_at timestamp", async () => {
    const { sessionStart } = await import("../../src/commands/session");

    // Suppress output
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    const sessionId = await sessionStart(testDb.db, testDb.projectId, "Another goal");

    console.log = originalLog;
    console.error = originalError;

    const session = testDb.rawDb
      .query<{ started_at: string }, [number]>(`SELECT started_at FROM sessions WHERE id = ?`)
      .get(sessionId);

    expect(session?.started_at).toBeDefined();
  });
});

describe("Session End", () => {
  let testDb: TestDb;
  let sessionId: number;

  beforeAll(async () => {
    testDb = createTestDb();

    // Create a session
    const { sessionStart } = await import("../../src/commands/session");

    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    sessionId = await sessionStart(testDb.db, testDb.projectId, "Session to end");

    console.log = originalLog;
    console.error = originalError;
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("ends session with outcome", async () => {
    const { sessionEnd } = await import("../../src/commands/session");

    // Suppress output
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    await sessionEnd(testDb.db, sessionId, ["--outcome", "Task completed successfully"]);

    console.log = originalLog;
    console.error = originalError;

    const session = testDb.rawDb
      .query<{ outcome: string; ended_at: string }, [number]>(
        `SELECT outcome, ended_at FROM sessions WHERE id = ?`
      )
      .get(sessionId);

    expect(session?.outcome).toBe("Task completed successfully");
    expect(session?.ended_at).toBeDefined();
  });

  test("sets success level", async () => {
    // Create new session (use rawDb for direct SQL)
    const result = testDb.rawDb.run(`INSERT INTO sessions (project_id, goal) VALUES (?, ?)`, [
      testDb.projectId,
      "Success test",
    ]);
    const newSessionId = Number(result.lastInsertRowid);

    const { sessionEnd } = await import("../../src/commands/session");

    // Suppress output
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    await sessionEnd(testDb.db, newSessionId, ["--success", "2"]);

    console.log = originalLog;
    console.error = originalError;

    const session = testDb.rawDb.query<{ success: number }, [number]>(`SELECT success FROM sessions WHERE id = ?`).get(newSessionId);

    expect(session?.success).toBe(2);
  });

  test("sets next steps", async () => {
    const result = testDb.rawDb.run(`INSERT INTO sessions (project_id, goal) VALUES (?, ?)`, [
      testDb.projectId,
      "Next steps test",
    ]);
    const newSessionId = Number(result.lastInsertRowid);

    const { sessionEnd } = await import("../../src/commands/session");

    // Suppress output
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    await sessionEnd(testDb.db, newSessionId, ["--next", "Continue with feature X"]);

    console.log = originalLog;
    console.error = originalError;

    const session = testDb.rawDb
      .query<{ next_steps: string }, [number]>(`SELECT next_steps FROM sessions WHERE id = ?`)
      .get(newSessionId);

    expect(session?.next_steps).toBe("Continue with feature X");
  });
});

describe("Session List", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = createTestDb();

    // Create multiple sessions with explicit timestamps for ordering (use rawDb for direct SQL)
    testDb.rawDb.run(
      `INSERT INTO sessions (project_id, goal, outcome, success, started_at) VALUES (?, ?, ?, ?, datetime('now', '-2 hours'))`,
      [testDb.projectId, "Session 1", "Outcome 1", 2]
    );
    testDb.rawDb.run(
      `INSERT INTO sessions (project_id, goal, outcome, success, started_at) VALUES (?, ?, ?, ?, datetime('now', '-1 hour'))`,
      [testDb.projectId, "Session 2", "Outcome 2", 1]
    );
    testDb.rawDb.run(`INSERT INTO sessions (project_id, goal, started_at) VALUES (?, ?, datetime('now'))`, [
      testDb.projectId,
      "Session 3",
    ]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("lists all sessions", async () => {
    const { sessionList } = await import("../../src/commands/session");

    const originalLog = console.log;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };

    await sessionList(testDb.db, testDb.projectId);

    console.log = originalLog;

    const sessions = JSON.parse(output);
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBe(3);
  });

  test("sessionLast returns most recent session", async () => {
    const { sessionLast } = await import("../../src/commands/session");

    const originalLog = console.log;
    const originalError = console.error;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };
    console.error = () => {};

    await sessionLast(testDb.db, testDb.projectId);

    console.log = originalLog;
    console.error = originalError;

    const session = JSON.parse(output);
    expect(session.goal).toBe("Session 3"); // Most recent by started_at
  });
});

describe("Session Count", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Create some sessions (use rawDb for direct SQL)
    testDb.rawDb.run(`INSERT INTO sessions (project_id, goal) VALUES (?, ?)`, [testDb.projectId, "Session 1"]);
    testDb.rawDb.run(`INSERT INTO sessions (project_id, goal) VALUES (?, ?)`, [testDb.projectId, "Session 2"]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("returns correct session count", async () => {
    const { sessionCount } = await import("../../src/commands/session");

    const count = await sessionCount(testDb.db, testDb.projectId);
    expect(count).toBe(2);
  });

  test("returns zero for project with no sessions", async () => {
    const { sessionCount } = await import("../../src/commands/session");

    // Create a new project with no sessions (use rawDb for direct SQL)
    const result = testDb.rawDb.run(`INSERT INTO projects (path, name) VALUES (?, ?)`, ["/tmp/empty", "Empty"]);
    const emptyProjectId = Number(result.lastInsertRowid);

    const count = await sessionCount(testDb.db, emptyProjectId);
    expect(count).toBe(0);
  });
});

describe("Generate Resume", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Create a session with full data (use rawDb for direct SQL)
    testDb.rawDb.run(
      `INSERT INTO sessions (project_id, goal, outcome, next_steps, ended_at) VALUES (?, ?, ?, ?, datetime('now'))`,
      [testDb.projectId, "Test goal", "Test outcome", "Next steps here"]
    );
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("generates resume text", async () => {
    const { generateResume } = await import("../../src/commands/session");

    const resume = await generateResume(testDb.db, testDb.projectId);

    expect(typeof resume).toBe("string");
    expect(resume.length).toBeGreaterThan(0);
  });
});
