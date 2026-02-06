/**
 * Error Event Detector — Regex-only error detection from Bash output
 *
 * Analyzes tool output (particularly Bash) for error patterns.
 * Deduplicates within 1 hour. Stores in error_events table.
 *
 * No LLM calls — pure regex matching. Phase 2 handles pattern analysis.
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

export interface DetectedError {
  errorType: ErrorType;
  message: string;
  signature: string;
  sourceFile?: string;
  stackTrace?: string;
}

type ErrorType =
  | "build_error"
  | "test_failure"
  | "runtime_error"
  | "type_error"
  | "exit_code"
  | "syntax_error"
  | "import_error";

// ============================================================================
// Error Patterns (ordered by specificity)
// ============================================================================

interface ErrorPattern {
  type: ErrorType;
  regex: RegExp;
  extractMessage: (match: RegExpMatchArray) => string;
  extractFile?: (match: RegExpMatchArray) => string | undefined;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // TypeScript build errors: error TS2345: Argument of type...
  {
    type: "build_error",
    regex: /error (TS\d+):\s*(.+)/,
    extractMessage: (m) => `${m[1]}: ${m[2]}`,
    extractFile: (m) => {
      // Look for file path before the error
      const line = m.input ?? "";
      const fileMatch = line.match(/^(.+?\.\w+)\(\d+,\d+\)/);
      return fileMatch?.[1];
    },
  },

  // Test failures: FAIL, AssertionError, expect(...).toBe(...)
  {
    type: "test_failure",
    regex: /(?:FAIL|FAILED)\s+(.+)/,
    extractMessage: (m) => m[1].trim(),
  },
  {
    type: "test_failure",
    regex: /AssertionError:\s*(.+)/,
    extractMessage: (m) => m[1],
  },
  {
    type: "test_failure",
    regex: /expect\(.+?\)\.(\w+)\(.+?\)/,
    extractMessage: (m) => `Assertion failed: ${m[0]}`,
  },

  // Runtime errors with stack traces
  {
    type: "runtime_error",
    regex: /(?:Error|TypeError|RangeError|ReferenceError|SyntaxError):\s*(.+)/,
    extractMessage: (m) => m[1],
    extractFile: (m) => {
      const line = m.input ?? "";
      const fileMatch = line.match(/at\s+.+?\((.+?:\d+:\d+)\)/);
      return fileMatch?.[1];
    },
  },

  // Import/module errors
  {
    type: "import_error",
    regex: /(?:Cannot find module|Module not found|Could not resolve)\s*['"](.+?)['"]/,
    extractMessage: (m) => `Cannot find module: ${m[1]}`,
  },

  // Syntax errors
  {
    type: "syntax_error",
    regex: /SyntaxError:\s*(.+)/,
    extractMessage: (m) => m[1],
  },

  // Generic non-zero exit code (must be last — least specific)
  {
    type: "exit_code",
    regex: /(?:exited with code|exit code|returned)\s+(\d+)/i,
    extractMessage: (m) => `Process exited with code ${m[1]}`,
  },
];

// ============================================================================
// Detection
// ============================================================================

/**
 * Detect errors in tool output. Returns array of detected errors.
 * Uses regex only — no LLM calls.
 */
export function detectErrors(output: string): DetectedError[] {
  if (!output || output.length === 0) return [];

  const errors: DetectedError[] = [];
  const seen = new Set<string>();
  const lines = output.split("\n");

  for (const line of lines) {
    for (const pattern of ERROR_PATTERNS) {
      const match = line.match(pattern.regex);
      if (!match) continue;

      const message = pattern.extractMessage(match);
      const sourceFile = pattern.extractFile?.(match);

      // Create signature for dedup: type + normalized message
      const signature = createSignature(pattern.type, message);
      if (seen.has(signature)) continue;
      seen.add(signature);

      // Try to extract stack trace (next 5 lines starting with "at")
      const lineIdx = lines.indexOf(line);
      const stackLines: string[] = [];
      for (let i = lineIdx + 1; i < Math.min(lineIdx + 6, lines.length); i++) {
        if (lines[i].trim().startsWith("at ")) {
          stackLines.push(lines[i].trim());
        } else {
          break;
        }
      }

      errors.push({
        errorType: pattern.type,
        message: message.slice(0, 500),
        signature,
        sourceFile,
        stackTrace: stackLines.length > 0 ? stackLines.join("\n") : undefined,
      });

      break; // One pattern match per line
    }
  }

  return errors;
}

/**
 * Create a normalized error signature for deduplication.
 * Replaces variable parts (numbers, paths, identifiers) with wildcards.
 */
export function createSignature(errorType: ErrorType, message: string): string {
  const normalized = message
    .replace(/\d+/g, "*")       // numbers -> *
    .replace(/'[^']+'/g, "'*'") // quoted strings -> '*'
    .replace(/"[^"]+"/g, '"*"') // double-quoted -> "*"
    .replace(/\/[\w./]+/g, "/*") // file paths -> /*
    .slice(0, 200);

  return `${errorType}:${normalized}`;
}

// ============================================================================
// Storage
// ============================================================================

/**
 * Record detected errors in the database.
 * Deduplicates: same signature within 1 hour is skipped.
 * Fire-and-forget — errors are swallowed.
 */
export function recordErrors(
  db: DatabaseAdapter,
  projectId: number,
  sessionId: number | null,
  toolCallId: number | null,
  errors: DetectedError[]
): void {
  if (errors.length === 0) return;

  // Fire and forget
  Promise.all(
    errors.map(async (error) => {
      // Check for recent duplicate (within 1 hour)
      const recent = await db.get<{ id: number }>(
        `SELECT id FROM error_events
         WHERE project_id = ? AND error_signature = ?
         AND created_at > datetime('now', '-1 hour')`,
        [projectId, error.signature]
      );
      if (recent) return; // Skip duplicate

      await db.run(
        `INSERT INTO error_events (project_id, session_id, error_type, error_message, error_signature, source_file, stack_trace, tool_call_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          sessionId,
          error.errorType,
          error.message,
          error.signature,
          error.sourceFile ?? null,
          error.stackTrace ?? null,
          toolCallId,
        ]
      );
    })
  ).catch(() => {
    // Swallow — error detection must never break tool calls
  });
}
