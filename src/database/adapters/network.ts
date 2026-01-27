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

  async get<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const result = await this.client.execute({ sql, args: params || [] });
    return (result.rows[0] as T) || null;
  }

  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.client.execute({ sql, args: params || [] });
    return result.rows as T[];
  }

  async run(sql: string, params?: any[]): Promise<QueryResult> {
    const result = await this.client.execute({ sql, args: params || [] });
    return {
      lastInsertRowid: result.lastInsertRowid ?? 0,
      changes: result.rowsAffected,
    };
  }

  async exec(sql: string): Promise<void> {
    // Split on semicolons and execute each statement
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await this.client.execute(stmt);
    }
  }

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
