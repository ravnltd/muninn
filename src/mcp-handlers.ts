// @muninn — context in .muninn/context/
/**
 * Muninn MCP Handlers — In-Process
 *
 * v9: Only recall, remember, track, and passthrough handlers are used by MCP.
 * Legacy handlers retained for CLI compatibility but not exposed as tools.
 */

import type { DatabaseAdapter } from "./database/adapter";
import { silentCatch } from "./utils/silent-catch.js";

// ============================================================================
// Console Output Capture
// ============================================================================

/** Sentinel error thrown when a command calls process.exit() */
class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "ProcessExitError";
  }
}

/**
 * Capture console.log/console.error output from functions that write to console.
 * Also intercepts process.exit() calls to prevent killing the MCP server.
 */
const CAPTURE_TIMEOUT_MS = 30_000;

export async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;

  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  process.exit = ((code?: number) => {
    throw new ProcessExitError(code ?? 0);
    // biome-ignore lint/suspicious/noExplicitAny: process.exit override must match signature
  }) as any;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("[TIMEOUT] Command exceeded 30s limit")),
        CAPTURE_TIMEOUT_MS
      );
      timer.unref();
    });

    await Promise.race([fn(), timeoutPromise]);
    return lines.join("\n");
  } catch (error) {
    if (error instanceof ProcessExitError) {
      return lines.join("\n");
    }
    if (error instanceof Error && error.message.includes("[TIMEOUT]")) {
      lines.push(error.message);
      return lines.join("\n");
    }
    throw error;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }
}

// ============================================================================
// v9: Ambient Brain Handlers
// ============================================================================

export async function handleRecall(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  params: { files?: string[]; query?: string; task?: string },
): Promise<{ text: string; resultIds: string | null }> {
  const { recall, formatRecallResult } = await import("./v9/recall.js");
  const result = await recall(db, projectId, cwd, params);
  return { text: formatRecallResult(result), resultIds: result.resultIds };
}

export async function handleRemember(
  db: DatabaseAdapter,
  projectId: number,
  params: {
    content: string;
    type?: "decision" | "learning";
    files?: string[];
    id?: number;
    supersedes?: number;
    alternatives?: string[];
    revisit_when?: string;
    durability?: "permanent" | "project" | "session";
  },
): Promise<string> {
  const { remember, formatRememberResult } = await import("./v9/remember.js");
  const result = await remember(db, projectId, params);
  return formatRememberResult(result);
}

export async function handleTrack(
  db: DatabaseAdapter,
  projectId: number,
  params: { action: string; title?: string; description?: string; severity?: number; type?: string; files?: string[]; id?: number; resolution?: string },
): Promise<string> {
  const { track, formatTrackResult } = await import("./v9/track.js");

  if (params.action === "add") {
    const result = await track(db, projectId, {
      action: "add",
      title: params.title ?? "Untitled issue",
      description: params.description,
      severity: params.severity,
      type: params.type as "bug" | "debt" | "security" | "performance" | undefined,
      files: params.files,
    });
    return formatTrackResult(result);
  }

  if (params.action === "resolve") {
    if (!params.id) throw new Error("Issue ID required for resolve");
    const result = await track(db, projectId, {
      action: "resolve",
      id: params.id,
      resolution: params.resolution ?? "Resolved",
    });
    return formatTrackResult(result);
  }

  throw new Error(`Unknown track action: ${params.action}`);
}

export async function handleCapture(
  db: DatabaseAdapter,
  projectId: number,
  params: { files: Array<{ path: string; content?: string }> },
): Promise<string> {
  const { captureBatch, formatCaptureResult } = await import("./v9/capture.js");
  const results = await captureBatch(db, projectId, params.files);
  return results.map(formatCaptureResult).join("\n");
}

// ============================================================================
// Passthrough Command Router
// ============================================================================

/**
 * Route passthrough commands to their handler functions in-process.
 * v9: Reduced to 5 essential commands. Others remain in CLI.
 */
export async function handlePassthrough(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  subcommand: string,
  args: string[]
): Promise<string> {
  return captureOutput(async () => {
    switch (subcommand) {
      case "status": {
        const { showStatus } = await import("./commands/analysis");
        await showStatus(db, projectId);
        break;
      }
      case "fragile": {
        const { showFragile } = await import("./commands/analysis");
        await showFragile(db, projectId);
        break;
      }
      case "outcome": {
        const { handleOutcomeCommand } = await import("./commands/outcomes");
        await handleOutcomeCommand(db, projectId, args);
        break;
      }
      case "reindex": {
        const { reindexProject } = await import("./code-intel/ast-parser");
        const { buildAndPersistCallGraph } = await import("./code-intel/call-graph");
        const { buildAndPersistTestMap } = await import("./code-intel/test-mapper");
        console.error("Reindexing project symbols...");
        const symbolResult = await reindexProject(db, projectId, cwd);
        console.error(`Symbols: ${symbolResult.parsed} parsed, ${symbolResult.symbols} symbols, ${symbolResult.skipped} skipped`);
        if (symbolResult.parsed > 0) {
          const { readdirSync, statSync: statSyncFn } = await import("node:fs");
          const { relative: relativeFn, extname: extnameFn, join: joinFn } = await import("node:path");
          const codeExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
          const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
          const allFiles: string[] = [];
          const walkDir = (dir: string, depth = 0): void => {
            if (depth > 15 || allFiles.length >= 2000) return;
            try {
              for (const entry of readdirSync(dir)) {
                if (allFiles.length >= 2000) break;
                if (entry.startsWith(".") || ignoreDirs.has(entry)) continue;
                const full = joinFn(dir, entry);
                const st = statSyncFn(full);
                if (st.isDirectory()) walkDir(full, depth + 1);
                else if (st.isFile() && codeExts.has(extnameFn(entry))) {
                  allFiles.push(relativeFn(cwd, full));
                }
              }
            } catch (e) { silentCatch("handlers:reindex-walk")(e); }
          };
          walkDir(cwd);
          console.error("Building call graph...");
          const cgResult = await buildAndPersistCallGraph(db, projectId, cwd, allFiles);
          console.error(`Call graph: ${cgResult.edges} edges from ${cgResult.files} files`);
          console.error("Building test-source map...");
          const tmResult = await buildAndPersistTestMap(db, projectId, cwd);
          console.error(`Test map: ${tmResult.mappings} mappings from ${tmResult.tests} test files`);
        }
        break;
      }
      case "db": {
        const { handleDatabaseCommand } = await import("./commands/database");
        handleDatabaseCommand(db, args);
        break;
      }
      case "list": {
        const { handleListCommand } = await import("./commands/list");
        await handleListCommand(db, projectId, args);
        break;
      }
      case "show": {
        const { handleShowCommand } = await import("./commands/list");
        await handleShowCommand(db, projectId, args);
        break;
      }
      case "search": {
        const { handleSearchCommand } = await import("./commands/list");
        await handleSearchCommand(db, projectId, args);
        break;
      }
      default:
        throw new Error(`Unknown passthrough command: ${subcommand}`);
    }
  });
}
