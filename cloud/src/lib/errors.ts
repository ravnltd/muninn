/**
 * Error Sanitization
 *
 * Maps known error patterns to safe client-facing messages.
 * Logs full error details server-side with request IDs.
 */

import { logError } from "./logger";

interface SafeError {
  message: string;
  status: number;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; safe: SafeError }> = [
  { pattern: /already registered/i, safe: { message: "Account creation failed", status: 409 } },
  { pattern: /email.*exists/i, safe: { message: "Account creation failed", status: 409 } },
  { pattern: /stripe/i, safe: { message: "Billing service error", status: 502 } },
  { pattern: /turso/i, safe: { message: "Database service error", status: 502 } },
  { pattern: /ECONNREFUSED/i, safe: { message: "Service temporarily unavailable", status: 503 } },
  { pattern: /timeout/i, safe: { message: "Request timed out", status: 504 } },
];

/**
 * Sanitize an error for client-facing responses.
 * Returns a safe message + request ID. Logs the full error server-side.
 */
export function sanitizeError(
  error: unknown,
  context: string,
  requestId: string,
  fallbackStatus = 500
): { message: string; status: number; requestId: string } {
  const rawMessage = error instanceof Error ? error.message : String(error);

  // Log full error with request ID for correlation
  logError(context, error, requestId);

  // Match against known patterns
  for (const { pattern, safe } of ERROR_PATTERNS) {
    if (pattern.test(rawMessage)) {
      return { message: safe.message, status: safe.status, requestId };
    }
  }

  return {
    message: "An unexpected error occurred",
    status: fallbackStatus,
    requestId,
  };
}

/**
 * Generate a short request ID for error correlation.
 */
export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
