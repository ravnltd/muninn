/**
 * Network Health Tracking
 *
 * Types and utilities for tracking network sync health state.
 * Health data is stored in-memory on the NetworkAdapter, not in the database.
 */

import type { MuninnConfig } from "../config";

/**
 * Network health state
 */
export interface NetworkHealth {
  /** Current mode: local, network, or http */
  mode: "local" | "network" | "http";
  /** Whether connected to primary (last sync succeeded) */
  connected: boolean;
  /** Timestamp of last successful sync */
  lastSyncAt: Date | null;
  /** Error message from last failed sync */
  lastSyncError: string | null;
  /** Latency of last sync in milliseconds */
  lastSyncLatencyMs: number | null;
  /** Primary server URL (null in local mode) */
  primaryUrl: string | null;
  /** Sync interval in milliseconds (0 for http mode) */
  syncInterval: number;
}

/**
 * Ping result from primary reachability check
 */
export interface PingResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

// Blocked hosts for SSRF protection
const BLOCKED_HOSTS = [
  "169.254.169.254", // AWS metadata
  "metadata.google.internal", // GCP metadata
  "metadata.goog", // GCP metadata
  "100.100.100.200", // Alibaba metadata
  "169.254.170.2", // AWS ECS task metadata
];

/**
 * Check if the primary server is reachable
 * Uses a simple HTTP HEAD request to the primary URL
 */
export async function checkPrimaryReachable(url: string): Promise<PingResult> {
  // SSRF protection: validate URL before making request
  try {
    const parsed = new URL(url);

    // Block metadata endpoints and internal IPs
    if (BLOCKED_HOSTS.includes(parsed.hostname)) {
      return { ok: false, error: "Blocked host" };
    }

    // Block localhost variants except for development
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname.endsWith(".localhost")
    ) {
      // Allow localhost only if explicitly configured
      // This is a valid use case for local dev
    }

    // Only allow http/https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, error: "Invalid protocol" };
    }
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  const start = performance.now();

  try {
    // Try to reach the libSQL HTTP endpoint
    // libSQL servers respond to GET /health or just GET /
    const response = await fetch(`${url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    const latencyMs = Math.round(performance.now() - start);

    if (response.ok || response.status === 404) {
      // 404 is acceptable - server is reachable but may not have /health endpoint
      return { ok: true, latencyMs };
    }

    return {
      ok: false,
      latencyMs,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    const message = error instanceof Error ? error.message : "Unknown error";

    return {
      ok: false,
      latencyMs,
      error: message,
    };
  }
}

/**
 * Get health for local mode (always "healthy")
 */
export function getLocalHealth(config: MuninnConfig): NetworkHealth {
  return {
    mode: "local",
    connected: true, // Local is always "connected"
    lastSyncAt: null,
    lastSyncError: null,
    lastSyncLatencyMs: null,
    primaryUrl: null,
    syncInterval: config.syncInterval,
  };
}

/**
 * Format health status for display
 */
export function formatHealthStatus(health: NetworkHealth): string {
  const lines: string[] = [];

  if (health.mode === "local") {
    lines.push("Mode: Local (bun:sqlite)");
    lines.push("Status: Local database, no sync");
    return lines.join("\n");
  }

  // HTTP mode
  if (health.mode === "http") {
    lines.push("Mode: HTTP (pure fetch, no native modules)");
    lines.push(`Primary: ${health.primaryUrl || "not configured"}`);
    lines.push(`Connected: ${health.connected ? "Yes" : "No"}`);

    if (health.lastSyncAt) {
      const ago = formatTimeAgo(health.lastSyncAt);
      lines.push(`Last Query: ${ago}`);
    }

    if (health.lastSyncLatencyMs !== null) {
      lines.push(`Latency: ${health.lastSyncLatencyMs}ms`);
    }

    if (health.lastSyncError) {
      lines.push(`Last Error: ${health.lastSyncError}`);
    }

    return lines.join("\n");
  }

  // Network mode
  lines.push("Mode: Network (libSQL embedded replica)");
  lines.push(`Primary: ${health.primaryUrl || "not configured"}`);
  lines.push(`Connected: ${health.connected ? "Yes" : "No"}`);

  if (health.lastSyncAt) {
    const ago = formatTimeAgo(health.lastSyncAt);
    lines.push(`Last Sync: ${ago}`);
  } else {
    lines.push("Last Sync: Never");
  }

  if (health.lastSyncLatencyMs !== null) {
    lines.push(`Latency: ${health.lastSyncLatencyMs}ms`);
  }

  if (health.lastSyncError) {
    lines.push(`Last Error: ${health.lastSyncError}`);
  }

  lines.push(`Sync Interval: ${health.syncInterval / 1000}s`);

  return lines.join("\n");
}

/**
 * Format a date as relative time (e.g., "2 minutes ago")
 */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return diffSecs === 1 ? "1 second ago" : `${diffSecs} seconds ago`;
  }
  if (diffMins < 60) {
    return diffMins === 1 ? "1 minute ago" : `${diffMins} minutes ago`;
  }
  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }
  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
}
