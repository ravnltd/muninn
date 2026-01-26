/**
 * Memory commands integration tests
 * Tests file, decision, issue, and learning commands
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "../helpers/db-setup";

describe("File Commands", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import file commands", async () => {
    const memory = await import("../../src/commands/memory");
    expect(typeof memory.fileGet).toBe("function");
    expect(typeof memory.fileList).toBe("function");
    expect(typeof memory.fileAdd).toBe("function");
  });

  test("fileGet returns not found for missing file", async () => {
    const { fileGet } = await import("../../src/commands/memory");

    // Capture stdout
    const originalLog = console.log;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };

    fileGet(testDb.db, testDb.projectId, "nonexistent.ts");

    console.log = originalLog;

    const result = JSON.parse(output);
    expect(result.found).toBe(false);
  });

  test("fileList returns empty array for new project", async () => {
    const { fileList } = await import("../../src/commands/memory");

    const originalLog = console.log;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };

    fileList(testDb.db, testDb.projectId);

    console.log = originalLog;

    const result = JSON.parse(output);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  test("can add and retrieve file", async () => {
    // Insert file directly
    testDb.db.run(
      `INSERT INTO files (project_id, path, purpose, fragility) VALUES (?, ?, ?, ?)`,
      [testDb.projectId, "src/test.ts", "Test file", 5]
    );

    const { fileGet } = await import("../../src/commands/memory");

    // Get file
    const originalLog = console.log;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };

    fileGet(testDb.db, testDb.projectId, "src/test.ts");

    console.log = originalLog;

    const file = JSON.parse(output);
    expect(file.found).toBe(true);
    expect(file.path).toBe("src/test.ts");
    expect(file.purpose).toBe("Test file");
    expect(file.fragility).toBe(5);
  });

  test("fileList filters by type", async () => {
    // Insert files with different types
    testDb.db.run(
      `INSERT INTO files (project_id, path, type) VALUES (?, ?, ?)`,
      [testDb.projectId, "src/component.tsx", "component"]
    );
    testDb.db.run(
      `INSERT INTO files (project_id, path, type) VALUES (?, ?, ?)`,
      [testDb.projectId, "src/util.ts", "util"]
    );

    const { fileList } = await import("../../src/commands/memory");

    const originalLog = console.log;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };

    fileList(testDb.db, testDb.projectId, "component");

    console.log = originalLog;

    const files = JSON.parse(output);
    expect(files.every((f: { type: string }) => f.type === "component")).toBe(true);
  });
});

describe("Decision Commands", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import decision commands", async () => {
    const memory = await import("../../src/commands/memory");
    expect(typeof memory.decisionAdd).toBe("function");
    expect(typeof memory.decisionList).toBe("function");
  });

  test("decisionList returns decisions", async () => {
    // Insert decision directly
    testDb.db.run(
      `INSERT INTO decisions (project_id, title, decision, reasoning) VALUES (?, ?, ?, ?)`,
      [testDb.projectId, "Use TypeScript", "For type safety", "Catches bugs early"]
    );

    const { decisionList } = await import("../../src/commands/memory");

    const originalLog = console.log;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };

    decisionList(testDb.db, testDb.projectId);

    console.log = originalLog;

    const decisions = JSON.parse(output);
    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions.length).toBeGreaterThan(0);
  });
});

describe("Issue Commands", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import issue commands", async () => {
    const memory = await import("../../src/commands/memory");
    expect(typeof memory.issueAdd).toBe("function");
    expect(typeof memory.issueList).toBe("function");
    expect(typeof memory.issueResolve).toBe("function");
  });

  test("issueList filters by status", async () => {
    // Insert open and resolved issues
    testDb.db.run(
      `INSERT INTO issues (project_id, title, status) VALUES (?, ?, ?)`,
      [testDb.projectId, "Open issue", "open"]
    );
    testDb.db.run(
      `INSERT INTO issues (project_id, title, status) VALUES (?, ?, ?)`,
      [testDb.projectId, "Resolved issue", "resolved"]
    );

    const { issueList } = await import("../../src/commands/memory");

    const originalLog = console.log;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };

    issueList(testDb.db, testDb.projectId, "open");

    console.log = originalLog;

    const issues = JSON.parse(output);
    expect(issues.every((i: { status: string }) => i.status === "open")).toBe(true);
  });

  test("issueResolve updates status", async () => {
    const result = testDb.db.run(
      `INSERT INTO issues (project_id, title, status) VALUES (?, ?, ?)`,
      [testDb.projectId, "To resolve", "open"]
    );
    const issueId = Number(result.lastInsertRowid);

    const { issueResolve } = await import("../../src/commands/memory");

    // Suppress output
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    issueResolve(testDb.db, issueId, "Fixed the bug");

    console.log = originalLog;
    console.error = originalError;

    const issue = testDb.db
      .query<{ status: string; resolution: string }, [number]>(
        `SELECT status, resolution FROM issues WHERE id = ?`
      )
      .get(issueId);

    expect(issue?.status).toBe("resolved");
    expect(issue?.resolution).toBe("Fixed the bug");
  });
});

describe("Learning Commands", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import learning commands", async () => {
    const memory = await import("../../src/commands/memory");
    expect(typeof memory.learnAdd).toBe("function");
    expect(typeof memory.learnList).toBe("function");
  });

  test("learnList returns learnings object", async () => {
    testDb.db.run(
      `INSERT INTO learnings (project_id, category, title, content, context) VALUES (?, ?, ?, ?, ?)`,
      [testDb.projectId, "pattern", "Error handling", "Use Result types", "TypeScript"]
    );

    const { learnList } = await import("../../src/commands/memory");

    const originalLog = console.log;
    const originalError = console.error;
    let output = "";
    console.log = (msg: string) => {
      output = msg;
    };
    console.error = () => {};

    learnList(testDb.db, testDb.projectId);

    console.log = originalLog;
    console.error = originalError;

    const learnings = JSON.parse(output);
    // learnList returns { project: [...], global: [...] }
    expect(learnings).toHaveProperty("project");
    expect(learnings).toHaveProperty("global");
    expect(Array.isArray(learnings.project)).toBe(true);
    expect(learnings.project.length).toBeGreaterThan(0);
  });
});

describe("Pattern Commands", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import pattern commands", async () => {
    const memory = await import("../../src/commands/memory");
    expect(typeof memory.patternAdd).toBe("function");
    expect(typeof memory.patternList).toBe("function");
  });
});

describe("Tech Debt Commands", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import debt commands", async () => {
    const memory = await import("../../src/commands/memory");
    expect(typeof memory.debtAdd).toBe("function");
    expect(typeof memory.debtList).toBe("function");
    expect(typeof memory.debtResolve).toBe("function");
  });
});
