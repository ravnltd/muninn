/**
 * Database Adapter Interface
 *
 * Provides a unified async interface for both local and HTTP database modes.
 * This allows the codebase to switch between bun:sqlite (local) and HTTP (sqld)
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
   * Initialize the adapter
   * Must be called after construction before any queries
   */
  init(): Promise<void>;

  /**
   * Sync operation (no-op in local and HTTP modes)
   * Kept for interface compatibility
   */
  sync(): Promise<void>;

  /**
   * Close the database connection
   */
  close(): void;

  /**
   * Get the underlying database instance (for compatibility)
   * Local: returns bun:sqlite Database
   * HTTP: returns undefined (no local instance)
   */
  // biome-ignore lint/suspicious/noExplicitAny: Returns underlying DB instance (bun:sqlite)
  raw(): any;

  /**
   * Get health status (HTTP mode only)
   * Returns undefined in local mode
   */
  getHealth?(): NetworkHealth;

  /**
   * Check if the adapter connection is healthy.
   * HTTP mode: tracks consecutive failures and circuit breaker state.
   * Local mode: always returns true.
   */
  isHealthy?(): boolean;
}
