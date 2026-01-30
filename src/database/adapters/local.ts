/**
 * Local Database Adapter
 *
 * Wraps bun:sqlite with a Promise-based async interface.
 * Since bun:sqlite is synchronous, operations return immediately with Promise.resolve()
 * for minimal overhead while maintaining interface compatibility.
 */

import type { Database } from "bun:sqlite";
import type { DatabaseAdapter, QueryResult } from "../adapter";

export class LocalAdapter implements DatabaseAdapter {
  constructor(private db: Database) {}

  async get<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const result = this.db.query<T, any[]>(sql).get(...(params || []));
    return result || null;
  }

  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.db.query<T, any[]>(sql).all(...(params || []));
  }

  async run(sql: string, params?: any[]): Promise<QueryResult> {
    const result = this.db.run(sql, params || []);
    return {
      lastInsertRowid: result.lastInsertRowid,
      changes: result.changes,
    };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async batch(statements: Array<{ sql: string; params?: any[] }>): Promise<void> {
    // Use transaction for atomicity
    this.db.run("BEGIN");
    try {
      for (const stmt of statements) {
        this.db.run(stmt.sql, stmt.params || []);
      }
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  async sync(): Promise<void> {
    // No-op in local mode
  }

  close(): void {
    this.db.close();
  }

  raw(): Database {
    return this.db;
  }
}
