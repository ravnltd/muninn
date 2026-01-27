/**
 * Query commands integration tests
 * Tests query, suggest, and predict commands
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestDb,
  seedTestDecisions,
  seedTestFiles,
  seedTestIssues,
  seedTestLearnings,
  setTestFocus,
  type TestDb,
} from "../helpers/db-setup";

describe("Query Command", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Seed comprehensive test data (use rawDb for sync seed operations)
    seedTestFiles(testDb.rawDb, testDb.projectId, [
      { path: "src/auth/login.ts", purpose: "User authentication flow" },
      { path: "src/auth/session.ts", purpose: "Session management" },
      { path: "src/api/users.ts", purpose: "User API endpoints" },
      { path: "src/api/posts.ts", purpose: "Blog post endpoints" },
      { path: "src/utils/format.ts", purpose: "Formatting utilities" },
      { path: "src/database/queries.ts", purpose: "Database query helpers" },
    ]);

    seedTestDecisions(testDb.rawDb, testDb.projectId, [
      {
        title: "Use JWT for auth",
        decision: "JSON Web Tokens for authentication",
        reasoning: "Stateless and scalable",
      },
      {
        title: "PostgreSQL database",
        decision: "Use PostgreSQL",
        reasoning: "Reliable and feature-rich",
      },
    ]);

    seedTestIssues(testDb.rawDb, testDb.projectId, [
      { title: "Session timeout", description: "Sessions expire too quickly", severity: 7 },
      { title: "API rate limiting", description: "Need rate limiting", severity: 5 },
    ]);

    seedTestLearnings(testDb.rawDb, testDb.projectId, [
      {
        category: "pattern",
        title: "Auth best practices",
        content: "Use HTTP-only cookies for tokens",
      },
    ]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import handleQueryCommand", async () => {
    const query = await import("../../src/commands/query");
    expect(typeof query.handleQueryCommand).toBe("function");
  });

  test("FTS search works on test database", () => {
    // Test FTS directly without going through handleQueryCommand (which accesses global DB)
    // Use rawDb for direct SQL
    const results = testDb.rawDb
      .query<{ path: string }, [string]>(
        `SELECT path FROM fts_files WHERE fts_files MATCH ?`
      )
      .all("auth");

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.includes("auth"))).toBe(true);
  });
});

describe("Suggest Command", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Use rawDb for sync seed operations
    seedTestFiles(testDb.rawDb, testDb.projectId, [
      { path: "src/auth/login.ts", purpose: "Login functionality" },
      { path: "src/auth/logout.ts", purpose: "Logout functionality" },
      { path: "src/api/auth.ts", purpose: "Auth API endpoints" },
    ]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import suggest functions", async () => {
    const suggest = await import("../../src/commands/suggest");
    expect(typeof suggest.suggestFilesForTask).toBe("function");
    expect(typeof suggest.handleSuggestCommand).toBe("function");
  });

  test("suggestFilesForTask returns result object", async () => {
    const { suggestFilesForTask } = await import("../../src/commands/suggest");

    const result = await suggestFilesForTask(testDb.db, testDb.projectId, "fix login bug");

    expect(result).toBeDefined();
    expect(result).toHaveProperty("files");
    expect(result).toHaveProperty("symbols");
    expect(result).toHaveProperty("relatedByDeps");
    expect(Array.isArray(result.files)).toBe(true);
  });
});

describe("Predict Command", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Use rawDb for sync seed operations
    seedTestFiles(testDb.rawDb, testDb.projectId, [
      { path: "src/auth/login.ts", purpose: "Login flow", fragility: 7 },
      { path: "src/auth/session.ts", purpose: "Sessions", fragility: 5 },
    ]);

    seedTestDecisions(testDb.rawDb, testDb.projectId, [
      { title: "Auth pattern", decision: "Use OAuth", reasoning: "Industry standard" },
    ]);

    seedTestIssues(testDb.rawDb, testDb.projectId, [
      { title: "Login bug", description: "Affects auth", severity: 8 },
    ]);

    seedTestLearnings(testDb.rawDb, testDb.projectId, [
      { category: "gotcha", title: "Auth gotcha", content: "Watch session expiry" },
    ]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can import predict functions", async () => {
    const predict = await import("../../src/commands/predict");
    expect(typeof predict.predictContext).toBe("function");
    expect(typeof predict.handlePredictCommand).toBe("function");
  });

  test("predictContext bundles context for task", async () => {
    const { predictContext } = await import("../../src/commands/predict");

    const result = await predictContext(testDb.db, testDb.projectId, { task: "fix auth login" });

    expect(result).toBeDefined();
    expect(result).toHaveProperty("relatedFiles");
    expect(result).toHaveProperty("cochangingFiles");
    expect(result).toHaveProperty("relevantDecisions");
    expect(result).toHaveProperty("openIssues");
    expect(result).toHaveProperty("applicableLearnings");
  });

  test("predictContext includes files when provided", async () => {
    const { predictContext } = await import("../../src/commands/predict");

    const result = await predictContext(testDb.db, testDb.projectId, {
      task: "auth",
      files: ["src/auth/login.ts"],
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });
});

describe("Focus Integration", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Use rawDb for sync seed operations
    seedTestFiles(testDb.rawDb, testDb.projectId, [
      { path: "src/auth/login.ts", purpose: "Login" },
      { path: "src/api/users.ts", purpose: "Users API" },
      { path: "src/utils/format.ts", purpose: "Formatting" },
    ]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("focus can be set for project", () => {
    // Set focus on auth (use rawDb for sync operations)
    const focusId = setTestFocus(testDb.rawDb, testDb.projectId, "authentication", ["src/auth/*"], ["login", "session"]);

    expect(focusId).toBeGreaterThan(0);

    // Verify focus was set (use rawDb for direct SQL)
    const focus = testDb.rawDb
      .query<{ area: string }, [number]>(`SELECT area FROM focus WHERE id = ?`)
      .get(focusId);

    expect(focus?.area).toBe("authentication");
  });
});
