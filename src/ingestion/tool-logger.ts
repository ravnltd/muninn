/**
 * Tool Call Logger — Fire-and-forget MCP tool call recording
 *
 * Wraps the MCP tool handler to log every call with timing, files involved,
 * and success/failure. Replaces the need for explicit session tracking calls.
 *
 * Performance: 1 async INSERT per call, non-blocking. Target: 0-2ms overhead.
 */

import type { DatabaseAdapter } from "../database/adapter";
import { getActiveSessionId } from "../commands/session-tracking";

// ============================================================================
// Types
// ============================================================================

export interface ToolCallRecord {
  projectId: number;
  sessionId: number | null;
  toolName: string;
  inputSummary: string;
  filesInvolved: string[];
  success: boolean;
  durationMs: number;
  errorMessage?: string;
}

// ============================================================================
// File Extraction
// ============================================================================

/** Extract file paths from tool call arguments */
export function extractFilesFromArgs(toolName: string, args: Record<string, unknown>): string[] {
  const files: string[] = [];

  // Direct file path arguments
  if (typeof args.path === "string") files.push(args.path);
  if (typeof args.file_path === "string") files.push(args.file_path);

  // Array of files (muninn_check)
  if (Array.isArray(args.files)) {
    for (const f of args.files) {
      if (typeof f === "string") files.push(f);
    }
  }

  // Enrichment input parsing
  if (toolName === "muninn_enrich" && typeof args.input === "string") {
    try {
      const parsed = JSON.parse(args.input) as Record<string, unknown>;
      if (typeof parsed.file_path === "string") files.push(parsed.file_path);
    } catch {
      // Not valid JSON, skip
    }
  }

  return [...new Set(files)];
}

/** Create a truncated summary of tool input (max 500 chars) */
export function summarizeInput(args: Record<string, unknown>): string {
  const summary = JSON.stringify(args);
  if (summary.length <= 500) return summary;
  return `${summary.slice(0, 497)}...`;
}

// ============================================================================
// Logger
// ============================================================================

/**
 * Log a tool call to the database. Fire-and-forget — errors are swallowed.
 */
export function logToolCall(db: DatabaseAdapter, record: ToolCallRecord): void {
  // Fire and forget — do not await
  db.run(
    `INSERT INTO tool_calls (project_id, session_id, tool_name, input_summary, files_involved, success, duration_ms, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.projectId,
      record.sessionId,
      record.toolName,
      record.inputSummary,
      record.filesInvolved.length > 0 ? JSON.stringify(record.filesInvolved) : null,
      record.success ? 1 : 0,
      record.durationMs,
      record.errorMessage ?? null,
    ]
  ).catch(() => {
    // Swallow errors — logging must never break tool calls
  });
}

/**
 * Create a tool call logger that captures timing and logs after execution.
 * Returns a wrapper that should be called before and after tool execution.
 */
export function createToolCallTimer(
  db: DatabaseAdapter,
  projectId: number,
  toolName: string,
  args: Record<string, unknown>
): { finish: (success: boolean, errorMessage?: string) => void } {
  const startTime = Date.now();
  const files = extractFilesFromArgs(toolName, args);
  const inputSummary = summarizeInput(args);

  return {
    finish(success: boolean, errorMessage?: string) {
      const durationMs = Date.now() - startTime;

      // Get session ID asynchronously — don't block
      getActiveSessionId(db, projectId)
        .then((sessionId) => {
          logToolCall(db, {
            projectId,
            sessionId,
            toolName,
            inputSummary,
            filesInvolved: files,
            success,
            durationMs,
            errorMessage,
          });
        })
        .catch(() => {
          // Fallback: log without session ID
          logToolCall(db, {
            projectId,
            sessionId: null,
            toolName,
            inputSummary,
            filesInvolved: files,
            success,
            durationMs,
            errorMessage,
          });
        });
    },
  };
}
