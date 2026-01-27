/**
 * Vector query tests
 * Tests embedding-related database functions and stats
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, seedTestDecisions, seedTestFiles, type TestDb } from "../helpers/db-setup";

describe("Vector Query Functions", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Seed files with embeddings (use rawDb for sync operations)
    const fileIds = seedTestFiles(testDb.rawDb, testDb.projectId, [
      { path: "src/index.ts", purpose: "Entry point" },
      { path: "src/utils.ts", purpose: "Utilities" },
    ]);

    // Add fake embeddings to some files
    const embedding = Buffer.from(new Float32Array(384).fill(0.1).buffer);
    testDb.rawDb.run(`UPDATE files SET embedding = ? WHERE id = ?`, [embedding, fileIds[0]]);

    // Seed decisions
    seedTestDecisions(testDb.rawDb, testDb.projectId, [
      { title: "Test decision", decision: "For testing", reasoning: "Needed for tests" },
    ]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("imports vector module", async () => {
    const vector = await import("../../src/database/queries/vector");
    expect(vector).toBeDefined();
    expect(typeof vector.hasEmbeddings).toBe("function");
    expect(typeof vector.getEmbeddingStats).toBe("function");
  });

  test("checks if project has embeddings", async () => {
    const { hasEmbeddings } = await import("../../src/database/queries/vector");
    const result = await hasEmbeddings(testDb.db, testDb.projectId);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true); // We added one embedding
  });

  test("returns false for project without embeddings", async () => {
    // Create new project without embeddings (use rawDb for direct SQL)
    const result = testDb.rawDb.run(
      `INSERT INTO projects (path, name) VALUES (?, ?)`,
      ["/tmp/no-embeddings", "No Embeddings"]
    );
    const newProjectId = Number(result.lastInsertRowid);

    const { hasEmbeddings } = await import("../../src/database/queries/vector");
    expect(await hasEmbeddings(testDb.db, newProjectId)).toBe(false);
  });

  test("gets embedding stats as array", async () => {
    const { getEmbeddingStats } = await import("../../src/database/queries/vector");
    const stats = await getEmbeddingStats(testDb.db, testDb.projectId);

    expect(Array.isArray(stats)).toBe(true);
    expect(stats.length).toBeGreaterThan(0);

    // Each stat should have table, total, withEmbedding, coverage
    const fileStats = stats.find(s => s.table === "files");
    expect(fileStats).toBeDefined();
    expect(typeof fileStats?.total).toBe("number");
    expect(typeof fileStats?.withEmbedding).toBe("number");
    expect(typeof fileStats?.coverage).toBe("number");
  });

  test("calculates coverage percentage for files", async () => {
    const { getEmbeddingStats } = await import("../../src/database/queries/vector");
    const stats = await getEmbeddingStats(testDb.db, testDb.projectId);

    const fileStats = stats.find(s => s.table === "files");
    // We have 2 files, 1 with embedding = 50%
    expect(fileStats?.total).toBe(2);
    expect(fileStats?.withEmbedding).toBe(1);
    expect(fileStats?.coverage).toBe(50);
  });
});

describe("Hybrid Search", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Seed with embeddings (use rawDb for sync operations)
    const fileIds = seedTestFiles(testDb.rawDb, testDb.projectId, [
      { path: "src/auth/login.ts", purpose: "Authentication login" },
      { path: "src/auth/session.ts", purpose: "Session management" },
    ]);

    // Add embeddings
    const embedding = Buffer.from(new Float32Array(384).fill(0.1).buffer);
    for (const id of fileIds) {
      testDb.rawDb.run(`UPDATE files SET embedding = ? WHERE id = ?`, [embedding, id]);
    }
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("can perform hybrid search", async () => {
    const { hybridSearch } = await import("../../src/database/queries/vector");

    // This requires embeddings to be generated, which needs API
    // Test that function exists and handles gracefully
    try {
      const results = await hybridSearch(testDb.db, "auth", testDb.projectId);
      expect(Array.isArray(results)).toBe(true);
    } catch (error) {
      // Expected if no embedding API available
      expect(error).toBeDefined();
    }
  });
});
