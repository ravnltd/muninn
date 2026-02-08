/**
 * API Validation Tests
 * Tests Zod validation on API endpoints
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAdapter } from "../src/database/adapters/local";
import { createApp } from "../src/web-server";

describe("API Validation", () => {
  let app: ReturnType<typeof createApp>;
  let tempDir: string;
  let testDb: Database;

  beforeAll(() => {
    // Create temp directory and test database
    tempDir = mkdtempSync(join(tmpdir(), "muninn-test-"));
    const dbPath = join(tempDir, "test.db");

    // Initialize test database with minimal schema
    testDb = new Database(dbPath);
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'active',
        mode TEXT,
        type TEXT,
        stack TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL,
        path TEXT NOT NULL,
        purpose TEXT,
        fragility INTEGER DEFAULT 1,
        temperature TEXT,
        archived_at DATETIME,
        velocity_score REAL,
        UNIQUE(project_id, path)
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        decision TEXT NOT NULL,
        reasoning TEXT,
        status TEXT DEFAULT 'active',
        temperature TEXT,
        archived_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'bug',
        severity INTEGER DEFAULT 5,
        status TEXT DEFAULT 'open',
        temperature TEXT,
        workaround TEXT,
        resolution TEXT,
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS learnings (
        id INTEGER PRIMARY KEY,
        project_id INTEGER,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT,
        context TEXT,
        temperature TEXT,
        archived_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL,
        goal TEXT,
        outcome TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        success INTEGER,
        session_number INTEGER,
        files_touched TEXT
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        relationship TEXT NOT NULL,
        strength INTEGER DEFAULT 5
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS fts_files USING fts5(path, purpose);

      INSERT INTO projects (id, name, path) VALUES (1, 'Test Project', '${tempDir}');
      INSERT INTO files (project_id, path, purpose, fragility) VALUES (1, 'src/index.ts', 'Entry point', 8);
      INSERT INTO decisions (project_id, title, decision) VALUES (1, 'Use TypeScript', 'Type safety');
      INSERT INTO issues (project_id, title, severity) VALUES (1, 'Bug 1', 7);
    `);

    // Pass a LocalAdapter wrapping the test DB
    app = createApp(new LocalAdapter(testDb));
  });

  afterAll(() => {
    testDb.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Helper to make requests
  async function request(path: string, options?: RequestInit) {
    const req = new Request(`http://localhost${path}`, options);
    return app.fetch(req);
  }

  describe("Path parameter validation", () => {
    test("returns 400 for non-numeric project ID", async () => {
      const res = await request("/api/projects/abc/health");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid project ID");
    });

    test("returns 400 for negative project ID", async () => {
      const res = await request("/api/projects/-1/health");
      expect(res.status).toBe(400);
    });

    test("returns 400 for zero project ID", async () => {
      const res = await request("/api/projects/0/health");
      expect(res.status).toBe(400);
    });

    test("returns 404 for non-existent project", async () => {
      const res = await request("/api/projects/9999/health");
      expect(res.status).toBe(404);
    });

    test("returns 200 for valid project ID", async () => {
      const res = await request("/api/projects/1/health");
      expect(res.status).toBe(200);
    });
  });

  describe("Issue validation", () => {
    test("returns 400 for missing title", async () => {
      const res = await request("/api/projects/1/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Validation failed");
    });

    test("returns 400 for invalid severity (> 10)", async () => {
      const res = await request("/api/projects/1/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test", severity: 15 }),
      });
      expect(res.status).toBe(400);
    });

    test("returns 400 for invalid severity (< 1)", async () => {
      const res = await request("/api/projects/1/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test", severity: 0 }),
      });
      expect(res.status).toBe(400);
    });

    test("returns 400 for invalid type", async () => {
      const res = await request("/api/projects/1/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test", type: "invalid-type" }),
      });
      expect(res.status).toBe(400);
    });

    test("creates issue with valid data", async () => {
      const res = await request("/api/projects/1/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Bug", severity: 5, type: "bug" }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
    });
  });

  describe("Issue resolution validation", () => {
    test("returns 400 for invalid issue ID", async () => {
      const res = await request("/api/projects/1/issues/abc/resolve", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: "Fixed" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid issue ID");
    });

    test("returns 400 for missing resolution", async () => {
      const res = await request("/api/projects/1/issues/1/resolve", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test("returns 404 for non-existent issue", async () => {
      const res = await request("/api/projects/1/issues/9999/resolve", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: "Fixed" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Decision validation", () => {
    test("returns 400 for missing title", async () => {
      const res = await request("/api/projects/1/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "Something" }),
      });
      expect(res.status).toBe(400);
    });

    test("returns 400 for missing decision", async () => {
      const res = await request("/api/projects/1/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Title" }),
      });
      expect(res.status).toBe(400);
    });

    test("creates decision with valid data", async () => {
      const res = await request("/api/projects/1/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Use Bun",
          decision: "Bun is fast",
          reasoning: "Performance",
        }),
      });
      expect(res.status).toBe(201);
    });
  });

  describe("Learning validation", () => {
    test("returns 400 for missing content", async () => {
      const res = await request("/api/projects/1/learnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Title" }),
      });
      expect(res.status).toBe(400);
    });

    test("returns 400 for invalid category", async () => {
      const res = await request("/api/projects/1/learnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Title",
          content: "Content",
          category: "invalid",
        }),
      });
      expect(res.status).toBe(400);
    });

    test("creates learning with valid data", async () => {
      const res = await request("/api/projects/1/learnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Bun is fast",
          content: "Bun runs TypeScript natively",
          category: "pattern",
        }),
      });
      expect(res.status).toBe(201);
    });
  });

  describe("Search validation", () => {
    test("returns empty array for missing query", async () => {
      const res = await request("/api/search");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    test("returns empty array for missing project_id", async () => {
      const res = await request("/api/search?q=test");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    test("returns empty array for invalid project_id", async () => {
      const res = await request("/api/search?q=test&project_id=abc");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });
  });
});
