/**
 * Database Adapter Interface
 *
 * Provides a unified async interface for both local and network database modes.
 * This allows the codebase to switch between bun:sqlite (local) and libSQL (network)
 * without changing query code.
 */

import type { NetworkHealth } from "./health";

export interface QueryResult {
  lastInsertRowid: bigint | number;
  changes: bigint | number;
}

export interface DatabaseAdapter {
  /**
   * Get a single row from a query
   */
  // biome-ignore lint/suspicious/noExplicitAny: Database params are inherently dynamic
  get<T = any>(sql: string, params?: any[]): Promise<T | null>;

  /**
   * Get all rows from a query
   */
  // biome-ignore lint/suspicious/noExplicitAny: Database params are inherently dynamic
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;

  /**
   * Execute a single statement (INSERT, UPDATE, DELETE)
   * Returns last insert ID and affected row count
   */
  // biome-ignore lint/suspicious/noExplicitAny: Database params are inherently dynamic
  run(sql: string, params?: any[]): Promise<QueryResult>;

  /**
   * Execute raw SQL (multiple statements, no results returned)
   * Used for schema creation, migrations, pragmas
   */
  exec(sql: string): Promise<void>;

  /**
   * Execute multiple statements in a transaction
   * All succeed or all fail
   */
  // biome-ignore lint/suspicious/noExplicitAny: Database params are inherently dynamic
  batch(statements: Array<{ sql: string; params?: any[] }>): Promise<void>;

  /**
   * Initialize the adapter (network mode: initial sync)
   * Must be called after construction before any queries
   */
  init(): Promise<void>;

  /**
   * Sync local changes to remote (network mode only)
   * No-op in local mode
   */
  sync(): Promise<void>;

  /**
   * Close the database connection
   */
  close(): void;

  /**
   * Get the underlying database instance (for compatibility)
   * Local: returns bun:sqlite Database
   * Network: returns libSQL Client
   */
  // biome-ignore lint/suspicious/noExplicitAny: Returns underlying DB instance (bun:sqlite or libSQL)
  raw(): any;

  /**
   * Get network health status (network mode only)
   * Returns undefined in local mode
   */
  getHealth?(): NetworkHealth;
}
