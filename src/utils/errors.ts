/**
 * Error handling utilities
 * Provides structured error handling and logging
 */

// ============================================================================
// Error Types
// ============================================================================

export type ErrorCode =
  | "DB_CONNECTION_ERROR"
  | "DB_QUERY_ERROR"
  | "FILE_NOT_FOUND"
  | "FILE_READ_ERROR"
  | "INVALID_ARGUMENT"
  | "MISSING_REQUIRED_ARGUMENT"
  | "API_ERROR"
  | "SSH_ERROR"
  | "VALIDATION_ERROR"
  | "PARSE_ERROR"
  | "COMMAND_NOT_FOUND"
  | "UNKNOWN_ERROR";

export class ContextError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ContextError";
    Object.setPrototypeOf(this, ContextError.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      success: false,
      error: this.message,
      code: this.code,
      context: this.context,
    };
  }
}

// ============================================================================
// Error Factory Functions
// ============================================================================

export function dbError(message: string, context?: Record<string, unknown>): ContextError {
  return new ContextError(message, "DB_QUERY_ERROR", context);
}

export function fileNotFoundError(path: string): ContextError {
  return new ContextError(`File not found: ${path}`, "FILE_NOT_FOUND", { path });
}

export function invalidArgumentError(message: string, context?: Record<string, unknown>): ContextError {
  return new ContextError(message, "INVALID_ARGUMENT", context);
}

export function missingArgumentError(argument: string): ContextError {
  return new ContextError(`Missing required argument: ${argument}`, "MISSING_REQUIRED_ARGUMENT", { argument });
}

export function apiError(message: string, status?: number): ContextError {
  return new ContextError(message, "API_ERROR", { status });
}

export function sshError(message: string, server?: string): ContextError {
  return new ContextError(message, "SSH_ERROR", { server });
}

export function validationError(message: string, field?: string): ContextError {
  return new ContextError(message, "VALIDATION_ERROR", { field });
}

export function parseError(message: string, source?: string): ContextError {
  return new ContextError(message, "PARSE_ERROR", { source });
}

// ============================================================================
// Error Logging
// ============================================================================

const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";

export function logError(source: string, error: unknown): void {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    console.error(`[${timestamp}] [${source}] ${errorMessage}`);
    if (stack && DEBUG) {
      console.error(stack);
    }
  }
}

export function logDebug(source: string, message: string, data?: unknown): void {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${source}] ${message}`);
    if (data !== undefined) {
      console.error(JSON.stringify(data, null, 2));
    }
  }
}

// ============================================================================
// Safe Wrappers
// ============================================================================

export function safeJsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

export function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export async function tryCatch<T>(
  fn: () => Promise<T>,
  source: string
): Promise<{ ok: true; value: T } | { ok: false; error: ContextError }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    logError(source, error);
    if (error instanceof ContextError) {
      return { ok: false, error };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, error: new ContextError(message, "UNKNOWN_ERROR") };
  }
}

export function tryCatchSync<T>(
  fn: () => T,
  source: string
): { ok: true; value: T } | { ok: false; error: ContextError } {
  try {
    const value = fn();
    return { ok: true, value };
  } catch (error) {
    logError(source, error);
    if (error instanceof ContextError) {
      return { ok: false, error };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, error: new ContextError(message, "UNKNOWN_ERROR") };
  }
}

// ============================================================================
// Exit Handlers
// ============================================================================

export function exitWithError(message: string, code: number = 1): never {
  console.error(`❌ ${message}`);
  process.exit(code);
}

export function exitWithUsage(usage: string): never {
  console.error(usage);
  process.exit(1);
}

// ============================================================================
// Result Type Helpers
// ============================================================================

export type Result<T, E = ContextError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
}
