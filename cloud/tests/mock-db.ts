/**
 * In-memory SQLite adapter for testing.
 *
 * Uses bun:sqlite with :memory: to provide a real SQL engine
 * without network dependencies. Loads the management schema
 * so all cloud tests can use real queries.
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseAdapter, QueryResult } from "../src/types";

export function createMockDb(): DatabaseAdapter & { raw(): Database } {
  const db = new Database(":memory:");

  // Load the management schema
  const schemaPath = join(import.meta.dir, "..", "src", "db", "schema.sql");
  const schemaSql = readFileSync(schemaPath, "utf-8");
  db.exec(schemaSql);

  return {
    async get<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = db.query(sql).get(...(params || [])) as T | null;
      return result || null;
    },
    async all<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return db.query(sql).all(...(params || [])) as T[];
    },
    async run(sql: string, params?: unknown[]): Promise<QueryResult> {
      const stmt = db.query(sql);
      stmt.run(...(params || []));
      // SQLite last_insert_rowid and changes
      const lastId = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
      const changes = db.query("SELECT changes() as c").get() as { c: number };
      return { lastInsertRowid: lastId.id, changes: changes.c };
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
    async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
      const transaction = db.transaction(() => {
        for (const stmt of statements) {
          db.query(stmt.sql).run(...(stmt.params || []));
        }
      });
      transaction();
    },
    async init(): Promise<void> {},
    async sync(): Promise<void> {},
    close(): void { db.close(); },
    raw(): Database { return db; },
  };
}

/**
 * Seed a tenant into the mock DB for testing.
 */
export async function seedTenant(
  db: DatabaseAdapter,
  overrides: Partial<{ id: string; email: string; plan: string; passwordHash: string }> = {}
): Promise<{ id: string; email: string }> {
  const id = overrides.id ?? crypto.randomUUID();
  const email = overrides.email ?? `test-${id.slice(0, 8)}@example.com`;
  const passwordHash = overrides.passwordHash ?? await Bun.password.hash("testpass123", { algorithm: "bcrypt", cost: 4 });
  const plan = overrides.plan ?? "free";

  await db.run(
    "INSERT INTO tenants (id, email, name, password_hash, plan) VALUES (?, ?, ?, ?, ?)",
    [id, email, "Test User", passwordHash, plan]
  );

  return { id, email };
}
