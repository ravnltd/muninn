/**
 * HTTP Database Adapter
 *
 * Pure HTTP adapter that talks directly to sqld via its v3/pipeline endpoint.
 * No native modules required - works in compiled binaries.
 *
 * Trade-offs vs NetworkAdapter (libSQL embedded replica):
 * - No local replica (every query hits server)
 * - No offline mode
 * - Higher latency for reads
 * - BUT: Works in compiled Bun binaries without native C++ modules
 */

import type { DatabaseAdapter, QueryResult } from "../adapter";
import type { NetworkHealth } from "../health";

// Hrana protocol types (v3/pipeline format)
// See: https://github.com/libsql/sqld/blob/main/docs/HRANA_3_SPEC.md

interface HranaValue {
  type: "null" | "integer" | "float" | "text" | "blob";
  value?: string | number | null;
  base64?: string;
}

interface HranaStatement {
  sql: string;
  args?: HranaValue[];
  named_args?: Array<{ name: string; value: HranaValue }>;
  want_rows?: boolean;
}

interface HranaRequest {
  type: "execute" | "batch" | "close";
  stmt?: HranaStatement;
  batch?: {
    steps: Array<{ stmt: HranaStatement }>;
  };
}

interface HranaColumn {
  name: string;
  decltype?: string | null;
}

interface HranaRow {
  [index: number]: HranaValue;
}

interface HranaStmtResult {
  cols: HranaColumn[];
  rows: HranaRow[];
  affected_row_count: number;
  last_insert_rowid: string | null;
  rows_read: number;
  rows_written: number;
}

interface HranaResult {
  type: "ok" | "error";
  response?: {
    type: "execute" | "batch";
    result?: HranaStmtResult;
    results?: Array<{ type: "ok" | "error"; response?: { result?: HranaStmtResult }; error?: HranaError }>;
  };
  error?: HranaError;
}

interface HranaError {
  message: string;
  code?: string;
}

interface HranaPipelineResponse {
  baton: string | null;
  base_url: string | null;
  results: HranaResult[];
}

export interface HttpAdapterConfig {
  primaryUrl: string;
  authToken?: string;
  timeout?: number;
}

export class HttpAdapter implements DatabaseAdapter {
  private config: HttpAdapterConfig;
  private initialized = false;

  // Health state tracking
  private _lastSyncAt: Date | null = null;
  private _lastSyncError: string | null = null;
  private _lastSyncLatencyMs: number | null = null;
  private _connected = false;

  // In-memory LRU cache for read queries
  private cache = new Map<string, { data: unknown; expiry: number; lastAccess: number }>();
  private readonly CACHE_TTL = 30_000; // 30 seconds
  private readonly CACHE_MAX_SIZE = 1000;

  constructor(config: HttpAdapterConfig) {
    this.config = config;
  }

  /**
   * Generate cache key from SQL and params
   */
  private getCacheKey(sql: string, params?: unknown[]): string {
    return `${sql}:${JSON.stringify(params || [])}`;
  }

  /**
   * Get from cache if valid. Returns { hit: true, data } or { hit: false }
   */
  private getFromCache<T>(key: string): { hit: true; data: T } | { hit: false } {
    const cached = this.cache.get(key);
    if (!cached) return { hit: false };

    const now = Date.now();
    if (now >= cached.expiry) {
      this.cache.delete(key);
      return { hit: false };
    }

    // Update last access for LRU
    cached.lastAccess = now;
    return { hit: true, data: cached.data as T };
  }

  /**
   * Store in cache with LRU eviction
   */
  private setCache(key: string, data: unknown): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.CACHE_MAX_SIZE) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;

      for (const [k, v] of this.cache) {
        if (v.lastAccess < oldestAccess) {
          oldestAccess = v.lastAccess;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const now = Date.now();
    this.cache.set(key, {
      data,
      expiry: now + this.CACHE_TTL,
      lastAccess: now,
    });
  }

  /**
   * Clear all cached data (called on writes)
   */
  private clearCache(): void {
    this.cache.clear();
  }

  /**
   * Initialize the adapter - verifies connectivity
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Test connection with a simple query
    try {
      await this.executeRequest([
        {
          type: "execute",
          stmt: { sql: "SELECT 1", want_rows: true },
        },
      ]);
      this._connected = true;
      this._lastSyncAt = new Date();
    } catch (error) {
      this._lastSyncError = error instanceof Error ? error.message : "Connection failed";
      throw error;
    }

    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("HttpAdapter.init() must be called before queries");
    }
  }

  // Retry config
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_BASE_MS = 200;

  /**
   * Check if an error is transient and worth retrying.
   */
  private isTransientError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      // Network errors, timeouts, server overload
      if (msg.includes("fetch failed") || msg.includes("econnrefused") ||
          msg.includes("econnreset") || msg.includes("etimedout") ||
          msg.includes("enetunreach") || msg.includes("abort") ||
          msg.includes("timeout") || msg.includes("socket hang up")) {
        return true;
      }
      // HTTP 5xx server errors
      if (/^http 5\d\d/.test(msg)) return true;
      // HTTP 429 rate limited
      if (msg.startsWith("http 429")) return true;
    }
    return false;
  }

  /**
   * Execute a pipeline request to sqld v3/pipeline endpoint.
   * Retries transient network errors with exponential backoff.
   */
  private async executeRequest(requests: HranaRequest[]): Promise<HranaPipelineResponse> {
    const url = `${this.config.primaryUrl}/v3/pipeline`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.authToken) {
      headers.Authorization = `Bearer ${this.config.authToken}`;
    }

    const body = JSON.stringify({
      baton: null,
      requests,
    });

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = this.RETRY_BASE_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const start = performance.now();

      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(this.config.timeout || 30000),
        });

        const latencyMs = Math.round(performance.now() - start);
        this._lastSyncLatencyMs = latencyMs;

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`HTTP ${response.status}: ${errorText}`);
          this._lastSyncError = error.message;
          this._connected = false;

          if (this.isTransientError(error) && attempt < this.MAX_RETRIES) {
            lastError = error;
            continue;
          }
          throw error;
        }

        const result = (await response.json()) as HranaPipelineResponse;

        // Check for errors in the results
        for (const res of result.results) {
          if (res.type === "error" && res.error) {
            throw new Error(res.error.message);
          }
        }

        this._lastSyncAt = new Date();
        this._lastSyncError = null;
        this._connected = true;

        return result;
      } catch (error) {
        this._lastSyncLatencyMs = Math.round(performance.now() - start);
        this._lastSyncError = error instanceof Error ? error.message : "Unknown error";
        this._connected = false;
        lastError = error;

        if (this.isTransientError(error) && attempt < this.MAX_RETRIES) {
          continue;
        }
        throw error;
      }
    }

    // Should be unreachable, but satisfy TypeScript
    throw lastError;
  }

  /**
   * Convert a JavaScript value to Hrana protocol format
   */
  private toHranaValue(value: unknown): HranaValue {
    if (value === null || value === undefined) {
      return { type: "null" };
    }
    if (typeof value === "number") {
      if (Number.isInteger(value)) {
        return { type: "integer", value: String(value) };
      }
      return { type: "float", value };
    }
    if (typeof value === "bigint") {
      return { type: "integer", value: String(value) };
    }
    if (typeof value === "string") {
      return { type: "text", value };
    }
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
      // Convert binary data to base64
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const base64 = Buffer.from(bytes).toString("base64");
      return { type: "blob", base64 };
    }
    // Default to text for other types
    return { type: "text", value: String(value) };
  }

  /**
   * Convert a Hrana value to a JavaScript value
   */
  private fromHranaValue(value: HranaValue): unknown {
    switch (value.type) {
      case "null":
        return null;
      case "integer": {
        // Parse as number if safe, otherwise keep as string for bigints
        const num = Number(value.value);
        if (Number.isSafeInteger(num)) {
          return num;
        }
        return BigInt(value.value as string);
      }
      case "float":
        return value.value;
      case "text":
        return value.value;
      case "blob":
        if (value.base64) {
          return Buffer.from(value.base64, "base64");
        }
        return null;
      default:
        return value.value;
    }
  }

  /**
   * Convert a Hrana row to a plain object
   */
  private rowToObject(columns: HranaColumn[], row: HranaRow): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const value = row[i];
      result[col.name] = value ? this.fromHranaValue(value) : null;
    }
    return result;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Database params are inherently dynamic
  async get<T = any>(sql: string, params?: any[]): Promise<T | null> {
    this.ensureInitialized();

    // Check cache first
    const cacheKey = this.getCacheKey(sql, params);
    const cached = this.getFromCache<T | null>(cacheKey);
    if (cached.hit) {
      return cached.data;
    }

    const args = params?.map((p) => this.toHranaValue(p));
    const response = await this.executeRequest([
      {
        type: "execute",
        stmt: { sql, args, want_rows: true },
      },
    ]);

    const result = response.results[0]?.response?.result;
    if (!result || result.rows.length === 0) {
      // Cache null results too (query returned no rows)
      this.setCache(cacheKey, null);
      return null;
    }

    const data = this.rowToObject(result.cols, result.rows[0]) as T;
    this.setCache(cacheKey, data);
    return data;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Database params are inherently dynamic
  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    this.ensureInitialized();

    // Check cache first
    const cacheKey = this.getCacheKey(sql, params);
    const cached = this.getFromCache<T[]>(cacheKey);
    if (cached.hit) {
      return cached.data;
    }

    const args = params?.map((p) => this.toHranaValue(p));
    const response = await this.executeRequest([
      {
        type: "execute",
        stmt: { sql, args, want_rows: true },
      },
    ]);

    const result = response.results[0]?.response?.result;
    if (!result) {
      this.setCache(cacheKey, []);
      return [];
    }

    const data = result.rows.map((row) => this.rowToObject(result.cols, row) as T);
    this.setCache(cacheKey, data);
    return data;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Database params are inherently dynamic
  async run(sql: string, params?: any[]): Promise<QueryResult> {
    this.ensureInitialized();

    // Clear cache on any write operation
    this.clearCache();

    const args = params?.map((p) => this.toHranaValue(p));
    const response = await this.executeRequest([
      {
        type: "execute",
        stmt: { sql, args, want_rows: false },
      },
    ]);

    const result = response.results[0]?.response?.result;
    return {
      lastInsertRowid: result?.last_insert_rowid ? BigInt(result.last_insert_rowid) : 0n,
      changes: result?.affected_row_count ?? 0,
    };
  }

  async exec(sql: string): Promise<void> {
    this.ensureInitialized();

    // Clear cache on any write operation
    this.clearCache();

    // Parse SQL into individual statements
    const statements = this.parseStatements(sql);

    // Filter out PRAGMAs and build batch request
    const requests: HranaRequest[] = [];
    for (const stmt of statements) {
      if (stmt.toLowerCase().startsWith("pragma ")) {
        continue;
      }
      requests.push({
        type: "execute",
        stmt: { sql: stmt, want_rows: false },
      });
    }

    // Send all statements in a single HTTP request
    if (requests.length > 0) {
      await this.executeRequest(requests);
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

  // biome-ignore lint/suspicious/noExplicitAny: Database params are inherently dynamic
  async batch(statements: Array<{ sql: string; params?: any[] }>): Promise<void> {
    this.ensureInitialized();

    // Clear cache on any write operation
    this.clearCache();

    // Wrap in BEGIN/COMMIT for transaction semantics
    const steps = [
      { stmt: { sql: "BEGIN", want_rows: false } as HranaStatement },
      ...statements.map((s) => ({
        stmt: {
          sql: s.sql,
          args: s.params?.map((p) => this.toHranaValue(p)),
          want_rows: false,
        } as HranaStatement,
      })),
      { stmt: { sql: "COMMIT", want_rows: false } as HranaStatement },
    ];

    await this.executeRequest([
      {
        type: "batch",
        batch: { steps },
      },
    ]);
  }

  /**
   * Sync is a no-op for HTTP mode - there's no local replica
   */
  async sync(): Promise<void> {
    // No-op - HTTP mode has no local replica to sync
    // Just verify connectivity
    await this.executeRequest([
      {
        type: "execute",
        stmt: { sql: "SELECT 1", want_rows: false },
      },
    ]);
  }

  /**
   * Get current network health status
   */
  getHealth(): NetworkHealth {
    return {
      mode: "http",
      connected: this._connected,
      lastSyncAt: this._lastSyncAt,
      lastSyncError: this._lastSyncError,
      lastSyncLatencyMs: this._lastSyncLatencyMs,
      primaryUrl: this.config.primaryUrl,
      syncInterval: 0, // No auto-sync in HTTP mode
    };
  }

  close(): void {
    // No-op: HTTP adapter is purely fetch-based with no persistent connection.
    // Do NOT reset `initialized` — in MCP mode, command handlers call
    // closeGlobalDb() (designed for CLI single-process mode) which would
    // invalidate the shared adapter and break subsequent tool calls.
  }

  raw(): null {
    // HTTP mode doesn't expose a raw client
    // Return null - callers should check
    return null;
  }
}
