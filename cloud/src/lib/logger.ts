/**
 * Structured JSON Logger
 *
 * Production-ready request/response logging with tenant context.
 * Replaces Hono's default text logger.
 */

import type { Context, Next } from "hono";

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  method: string;
  path: string;
  status: number;
  duration: number;
  requestId?: string;
  tenantId?: string;
  error?: string;
}

function formatLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Structured request logger middleware.
 * Logs method, path, status, duration, and tenant context.
 */
export function structuredLogger() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;
    const tenantId = c.get("tenantId") as string | undefined;
    const requestId = c.get("requestId") as string | undefined;

    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      method,
      path,
      status,
      duration,
    };

    if (requestId) entry.requestId = requestId;
    if (tenantId) entry.tenantId = tenantId;

    // Use stderr for errors, stdout for info
    if (level === "error") {
      process.stderr.write(formatLog(entry) + "\n");
    } else {
      process.stdout.write(formatLog(entry) + "\n");
    }
  };
}

/**
 * Log an error with context and optional request ID.
 */
export function logError(context: string, error: unknown, requestId?: string): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: "error",
    context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  if (requestId) entry.requestId = requestId;
  process.stderr.write(JSON.stringify(entry) + "\n");
}
