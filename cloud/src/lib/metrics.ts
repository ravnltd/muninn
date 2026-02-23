/**
 * Lightweight Prometheus Metrics
 *
 * Text format emitter for counters, histograms, and gauges.
 * No external deps — Bun-native.
 */

import type { Context, Next } from "hono";

// ============================================================================
// Counter
// ============================================================================

interface CounterLabels {
  [key: string]: string;
}

class Counter {
  private readonly name: string;
  private readonly help: string;
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: CounterLabels = {}, value = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  format(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key} ${value}`);
    }
    return lines.join("\n");
  }
}

// ============================================================================
// Gauge
// ============================================================================

class Gauge {
  private readonly name: string;
  private readonly help: string;
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(labels: CounterLabels, value: number): void {
    this.values.set(labelKey(labels), value);
  }

  setDirect(value: number): void {
    this.values.set("", value);
  }

  format(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key} ${value}`);
    }
    return lines.join("\n");
  }
}

// ============================================================================
// Histogram (simplified: pre-defined buckets)
// ============================================================================

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

class Histogram {
  private readonly name: string;
  private readonly help: string;
  private readonly buckets: number[];
  private readonly counts = new Map<string, { buckets: number[]; sum: number; count: number }>();

  constructor(name: string, help: string, buckets = DEFAULT_BUCKETS) {
    this.name = name;
    this.help = help;
    this.buckets = buckets;
  }

  observe(labels: CounterLabels, value: number): void {
    const key = labelKey(labels);
    let entry = this.counts.get(key);
    if (!entry) {
      entry = { buckets: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.counts.set(key, entry);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) entry.buckets[i]++;
    }
    entry.sum += value;
    entry.count++;
  }

  format(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, entry] of this.counts) {
      const labelStr = key ? key.slice(0, -1) + "," : "{";
      for (let i = 0; i < this.buckets.length; i++) {
        let cumulative = 0;
        for (let j = 0; j <= i; j++) cumulative += entry.buckets[j];
        lines.push(`${this.name}_bucket${labelStr}le="${this.buckets[i]}"} ${cumulative}`);
      }
      let total = 0;
      for (const b of entry.buckets) total += b;
      lines.push(`${this.name}_bucket${labelStr}le="+Inf"} ${total}`);
      lines.push(`${this.name}_sum${key} ${entry.sum}`);
      lines.push(`${this.name}_count${key} ${entry.count}`);
    }
    return lines.join("\n");
  }
}

// ============================================================================
// Registry
// ============================================================================

function labelKey(labels: CounterLabels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return "{" + entries.map(([k, v]) => `${k}="${v}"`).join(",") + "}";
}

// Singleton metrics instances
export const httpRequestsTotal = new Counter(
  "muninn_http_requests_total",
  "Total HTTP requests"
);

export const httpRequestDuration = new Histogram(
  "muninn_http_request_duration_seconds",
  "HTTP request duration in seconds"
);

export const toolCallsTotal = new Counter(
  "muninn_tool_calls_total",
  "Total MCP tool calls"
);

export const rateLimitHitsTotal = new Counter(
  "muninn_rate_limit_hits_total",
  "Total rate limit hits"
);

export const dbPoolSize = new Gauge(
  "muninn_db_pool_size",
  "Current tenant DB pool size"
);

export const activeMcpSessions = new Gauge(
  "muninn_active_mcp_sessions",
  "Active MCP sessions"
);

export const circuitBreakerState = new Gauge(
  "muninn_circuit_breaker_state",
  "Circuit breaker state (0=closed, 1=open, 2=half-open)"
);

/**
 * Format all metrics as Prometheus text exposition format.
 */
export function formatMetrics(): string {
  return [
    httpRequestsTotal.format(),
    httpRequestDuration.format(),
    toolCallsTotal.format(),
    rateLimitHitsTotal.format(),
    dbPoolSize.format(),
    activeMcpSessions.format(),
    circuitBreakerState.format(),
  ].join("\n\n") + "\n";
}

/**
 * Middleware that instruments every request with metrics.
 */
export function metricsMiddleware() {
  return async (c: Context, next: Next) => {
    const start = performance.now();
    await next();
    const duration = (performance.now() - start) / 1000;

    const method = c.req.method;
    const path = normalizePath(c.req.path);
    const status = String(c.res.status);

    httpRequestsTotal.inc({ method, path, status });
    httpRequestDuration.observe({ method, path }, duration);
  };
}

/**
 * Normalize path for metrics (collapse dynamic segments).
 */
function normalizePath(path: string): string {
  return path
    .replace(/\/keys\/[^/]+/, "/keys/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "/:id");
}
