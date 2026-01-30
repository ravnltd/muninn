/**
 * Network Database Adapter
 *
 * Uses libSQL embedded replica mode for local-first operation with remote sync.
 * - Local file for fast synchronous reads
 * - Async sync to central sqld primary on Tailscale network
 * - Auto-sync on interval, manual sync() method available
 */

import { createClient, type Client } from "@libsql/client";
import type { DatabaseAdapter, QueryResult } from "../adapter";
import type { NetworkHealth } from "../health";

export interface NetworkAdapterConfig {
  localPath: string;
  primaryUrl: string;
  authToken?: string;
  syncInterval?: number; // milliseconds
}

export class NetworkAdapter implements DatabaseAdapter {
  private client: Client;
  private syncTimer: Timer | null = null;
  private config: NetworkAdapterConfig;

  // Health state tracking
  private _lastSyncAt: Date | null = null;
  private _lastSyncError: string | null = null;
  private _lastSyncLatencyMs: number | null = null;
  private _connected: boolean = false;

  constructor(config: NetworkAdapterConfig) {
    this.config = config;

    // Create embedded replica client
    this.client = createClient({
      url: `file:${config.localPath}`,
      syncUrl: config.primaryUrl,
      authToken: config.authToken,
      syncInterval: config.syncInterval || 60000, // Default: 60s
    });

    // Start auto-sync
    this.startAutoSync(config.syncInterval || 60000);
  }

  private startAutoSync(interval: number): void {
    this.syncTimer = setInterval(async () => {
      try {
        await this.sync();
      } catch (error) {
        // Log but don't crash on sync failure
        console.error(`⚠️  Background sync failed: ${error}`);
      }
    }, interval);
  }

  // biome-ignore lint/suspicious/noExplicitAny: libSQL requires flexible param types
  async get<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const result = await this.client.execute({ sql, args: params || [] });
    return (result.rows[0] as T) || null;
  }

  // biome-ignore lint/suspicious/noExplicitAny: libSQL requires flexible param types
  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.client.execute({ sql, args: params || [] });
    return result.rows as T[];
  }

  // biome-ignore lint/suspicious/noExplicitAny: libSQL requires flexible param types
  async run(sql: string, params?: any[]): Promise<QueryResult> {
    const result = await this.client.execute({ sql, args: params || [] });
    return {
      lastInsertRowid: result.lastInsertRowid ?? 0,
      changes: result.rowsAffected,
    };
  }

  async exec(sql: string): Promise<void> {
    // Parse SQL into statements, handling comments and string literals
    const statements = this.parseStatements(sql);

    for (const stmt of statements) {
      // Skip PRAGMA statements - libSQL handles these automatically
      if (stmt.toLowerCase().startsWith("pragma ")) {
        continue;
      }
      await this.client.execute(stmt);
    }
  }

  /**
   * Parse SQL into individual statements, respecting:
   * - String literals (single and double quotes)
   * - SQL comments (-- line comments and block comments)
   * - BEGIN...END blocks (for triggers)
   * - Statement-ending semicolons
   */
  private parseStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = "";
    let inString: "'" | '"' | null = null;
    let inBlockComment = false;
    let inLineComment = false;
    let beginEndDepth = 0;

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const nextChar = sql[i + 1];

      // Handle line comments
      if (!inString && !inBlockComment && char === "-" && nextChar === "-") {
        inLineComment = true;
        i++; // Skip the second dash
        continue;
      }

      // End line comment on newline
      if (inLineComment && (char === "\n" || char === "\r")) {
        inLineComment = false;
        current += " "; // Replace comment with space
        continue;
      }

      // Skip characters in line comments
      if (inLineComment) {
        continue;
      }

      // Handle block comments
      if (!inString && !inBlockComment && char === "/" && nextChar === "*") {
        inBlockComment = true;
        i++; // Skip the asterisk
        continue;
      }

      // End block comment
      if (inBlockComment && char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++; // Skip the slash
        current += " "; // Replace comment with space
        continue;
      }

      // Skip characters in block comments
      if (inBlockComment) {
        continue;
      }

      // Handle string literals
      if (!inString && (char === "'" || char === '"')) {
        inString = char;
        current += char;
        continue;
      }

      // End string literal (check for escaped quotes)
      if (inString === char) {
        current += char;
        // Check for escaped quote (doubled)
        if (nextChar === char) {
          current += nextChar;
          i++; // Skip the escape
        } else {
          inString = null;
        }
        continue;
      }

      // Track BEGIN...END blocks (for triggers)
      if (!inString) {
        const remaining = sql.substring(i).toUpperCase();
        if (remaining.match(/^BEGIN\s/)) {
          beginEndDepth++;
          current += sql.substring(i, i + 5);
          i += 4;
          continue;
        }
        if (remaining.match(/^END\s*;/) || remaining.match(/^END$/)) {
          beginEndDepth = Math.max(0, beginEndDepth - 1);
        }
      }

      // Statement terminator (only if not in BEGIN...END block)
      if (!inString && char === ";" && beginEndDepth === 0) {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          statements.push(trimmed);
        }
        current = "";
        continue;
      }

      current += char;
    }

    // Don't forget any remaining content
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      statements.push(trimmed);
    }

    return statements;
  }

  // biome-ignore lint/suspicious/noExplicitAny: libSQL requires flexible param types
  async batch(statements: Array<{ sql: string; params?: any[] }>): Promise<void> {
    await this.client.batch(
      statements.map((stmt) => ({
        sql: stmt.sql,
        args: stmt.params || [],
      })),
      "write"
    );
  }

  async sync(): Promise<void> {
    const start = performance.now();

    try {
      await this.client.sync();
      const latencyMs = Math.round(performance.now() - start);

      // Update health state on success
      this._lastSyncAt = new Date();
      this._lastSyncError = null;
      this._lastSyncLatencyMs = latencyMs;
      this._connected = true;
    } catch (error) {
      const latencyMs = Math.round(performance.now() - start);

      // Update health state on failure
      this._lastSyncError = error instanceof Error ? error.message : "Unknown sync error";
      this._lastSyncLatencyMs = latencyMs;
      this._connected = false;

      // Re-throw so callers can handle
      throw error;
    }
  }

  /**
   * Get current network health status
   */
  getHealth(): NetworkHealth {
    return {
      mode: "network",
      connected: this._connected,
      lastSyncAt: this._lastSyncAt,
      lastSyncError: this._lastSyncError,
      lastSyncLatencyMs: this._lastSyncLatencyMs,
      primaryUrl: this.config.primaryUrl,
      syncInterval: this.config.syncInterval || 60000,
    };
  }

  close(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.client.close();
  }

  raw(): Client {
    return this.client;
  }
}
