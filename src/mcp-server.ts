#!/usr/bin/env bun
// @muninn — context in .muninn/context/

/**
 * Muninn — MCP Server v9 (Simplified)
 *
 * 4 tools: recall, remember, track, muninn
 * Zero ceremony. Clean hot path: DB init -> validate -> dispatch -> return.
 *
 * Split into:
 * - mcp-state.ts — Shared mutable state, getters/setters, helpers
 * - mcp-tool-definitions.ts — Pure data tool schema array
 * - mcp-resources.ts — MCP resource handlers
 * - mcp-lifecycle.ts — Session auto-start/end, worker spawning
 * - mcp-server.ts (this file) — Server creation, CallToolRequest handler, main()
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  RecallInput,
  RememberInput,
  TrackInput,
  PassthroughInput,
  validateInput,
} from "./mcp-validation.js";
import { createToolCallTimer } from "./ingestion/tool-logger.js";
import { normalizePaths } from "./utils/paths.js";
import {
  handleRecall,
  handleRemember,
  handleTrack,
  handlePassthrough,
} from "./mcp-handlers.js";
import { createLogger } from "./lib/logger.js";
import { silentCatch } from "./utils/silent-catch.js";
import { runBackground } from "./utils/background-tasks.js";
import { onShutdown, installSignalHandlers, shutdown } from "./utils/shutdown.js";

import {
  getDb,
  getProjectId,
  getDbAdapter,
  getConsecutiveKeepaliveFailures,
  setConsecutiveKeepaliveFailures,
  getConsecutiveSlowCalls,
  setConsecutiveSlowCalls,
  getExceptionWindow,
  EXCEPTION_WINDOW_MS,
  MAX_EXCEPTIONS_IN_WINDOW,
  isExpectedException,
  recordSuccessfulOperation,
  checkDegradedRestart,
  getSessionAutoStarted,
  setSessionAutoStarted,
  ALLOWED_PASSTHROUGH_COMMANDS,
  parseCommandArgs,
} from "./mcp-state.js";
import { TOOL_DEFINITIONS } from "./mcp-tool-definitions.js";
import { registerResourceHandlers } from "./mcp-resources.js";
import { autoStartSession, autoEndSession, spawnWorkerIfNeeded } from "./mcp-lifecycle.js";

const log = createLogger("mcp-server");

// ============================================================================
// Server Instance
// ============================================================================

const server = new Server(
  { name: "muninn", version: "9.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// ============================================================================
// Tool Definitions — 4 tools
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOL_DEFINITIONS };
});

// ============================================================================
// Tool Handler — Clean hot path
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = args as Record<string, unknown>;
  const cwd = (typedArgs.cwd as string) || process.cwd();

  log.debug(`Tool: ${name}`, { tool: name, args });

  let timer: ReturnType<typeof createToolCallTimer> | null = null;

  try {
    // Initialize shared DB adapter (cached after first call)
    const db = await getDb();
    const projectId = await getProjectId(db, cwd);

    // Tool call timer (fire-and-forget logging)
    timer = createToolCallTimer(db, projectId, name, typedArgs);

    // Session auto-start on first tool call
    if (!getSessionAutoStarted()) {
      setSessionAutoStarted(true);
      runBackground("session-auto-start", async () => {
        await autoStartSession(db, projectId);
      });
    }

    let result: string;

    switch (name) {
      // ========== v9: 4 TOOLS ==========

      case "recall": {
        const validation = validateInput(RecallInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        if (validation.data.files) {
          validation.data.files = normalizePaths(cwd, validation.data.files);
        }
        const recallResult = await handleRecall(db, projectId, validation.data.cwd || cwd, validation.data);
        result = recallResult.text;
        if (recallResult.resultIds && timer) {
          timer.setRecallResultIds(recallResult.resultIds);
        }
        break;
      }

      case "remember": {
        const validation = validateInput(RememberInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        result = await handleRemember(db, projectId, validation.data);
        break;
      }

      case "track": {
        const validation = validateInput(TrackInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const data = validation.data;
        if (data.action === "add" && data.files) {
          data.files = normalizePaths(cwd, data.files);
        }
        result = await handleTrack(db, projectId, data);
        break;
      }

      case "muninn": {
        const validation = validateInput(PassthroughInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { command } = validation.data;

        const parsedArgs = parseCommandArgs(command);
        if (parsedArgs.length === 0) throw new Error("Empty command");

        const subcommand = parsedArgs[0].toLowerCase();
        if (!ALLOWED_PASSTHROUGH_COMMANDS.has(subcommand)) {
          throw new Error(
            `Command "${subcommand}" not available. Allowed: ${[...ALLOWED_PASSTHROUGH_COMMANDS].sort().join(", ")}`
          );
        }

        const passthroughCwd = validation.data.cwd || cwd;
        result = await handlePassthrough(db, projectId, passthroughCwd, subcommand, parsedArgs.slice(1));
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Log successful tool call
    recordSuccessfulOperation();
    const durationMs = timer.finish(true);

    // Slow-call monitoring
    const SLOW_THRESHOLD_MS = 5_000;
    const SLOW_WARNING_THRESHOLD = 3;
    if (durationMs !== undefined && durationMs > SLOW_THRESHOLD_MS) {
      setConsecutiveSlowCalls(getConsecutiveSlowCalls() + 1);
    } else {
      setConsecutiveSlowCalls(0);
    }

    // Prepend slow-call warning if consecutive threshold exceeded
    const currentSlowCalls = getConsecutiveSlowCalls();
    if (currentSlowCalls >= SLOW_WARNING_THRESHOLD) {
      result = `[Slow responses detected — ${currentSlowCalls} consecutive calls >5s — check sqld connectivity]\n\n${result}`;
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(errMsg, { tool: name });

    timer?.finish(false, errMsg);

    // For "temporarily unavailable" errors, don't mark as isError
    // so Claude knows to retry rather than giving up
    const isRecoverable = errMsg.includes("temporarily unavailable");

    return {
      content: [{ type: "text", text: isRecoverable ? errMsg : `Error: ${errMsg}` }],
      isError: !isRecoverable,
    };
  }
});

// ============================================================================
// MCP Resources
// ============================================================================

registerResourceHandlers(server);

// ============================================================================
// Start Server
// ============================================================================

async function main(): Promise<void> {
  log.info("Starting Muninn MCP Server v9...");

  // --- Global error handlers ---
  process.on("unhandledRejection", (reason) => {
    log.error(`Unhandled rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  });
  process.on("uncaughtException", (error) => {
    log.error(`Uncaught exception: ${error.stack || error.message}`);

    if (isExpectedException(error)) {
      log.warn("Expected exception (not counted toward crash threshold)");
      return;
    }

    const now = Date.now();
    const exceptionWindow = getExceptionWindow();
    exceptionWindow.push(now);
    while (exceptionWindow.length > 0 && exceptionWindow[0] < now - EXCEPTION_WINDOW_MS) {
      exceptionWindow.shift();
    }

    if (exceptionWindow.length >= MAX_EXCEPTIONS_IN_WINDOW) {
      log.error(`${exceptionWindow.length} exceptions in ${EXCEPTION_WINDOW_MS / 1000}s — systemic failure, exiting`);
      shutdown(1);
    } else if (checkDegradedRestart()) {
      log.error("Sustained degraded state with no successful operations — restarting");
      shutdown(1);
    } else {
      log.warn(`Exception survived (${exceptionWindow.length}/${MAX_EXCEPTIONS_IN_WINDOW} in window)`);
    }
  });

  // --- Stdio pipe monitoring ---
  process.stdin.on("error", (err) => {
    log.error(`stdin error: ${err.message}`);
  });
  process.stdout.on("error", (err) => {
    if (err && "code" in err && err.code === "EPIPE") {
      log.warn("stdout pipe broken (parent disconnected)");
      shutdown(0);
    } else {
      log.error(`stdout error: ${err.message}`);
    }
  });
  process.stdin.on("end", () => {
    log.info("stdin ended (parent disconnected)");
    shutdown(0);
  });

  // Pre-warm the DB connection at startup
  try {
    const db = await getDb();
    log.info("Database adapter initialized");
    const defaultCwd = process.cwd();
    await getProjectId(db, defaultCwd);
    log.info("Project ID cached", { cwd: defaultCwd });
  } catch (error) {
    log.warn(`DB pre-warm failed (will retry on first tool call): ${error}`);
  }

  // --- MCP server error/close handlers ---
  server.onerror = (error) => {
    log.error(`MCP server error: ${error instanceof Error ? error.message : String(error)}`);
  };
  server.onclose = () => {
    // Stdio MCP servers cannot reconnect. Clean restart is the only recovery.
    log.info("MCP server connection closed — shutting down for clean restart");
    shutdown(0);
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server ready");

  // Write PID file for watchdog detection
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/muninn-mcp.pid", String(process.pid), { mode: 0o600 });
  } catch (e) {
    silentCatch("mcp:pid-file-write")(e);
  }

  // --- Adaptive keepalive ---
  const KEEPALIVE_NORMAL_MS = 60_000;
  const KEEPALIVE_RECOVERY_MS = 10_000;
  let keepaliveTimerId: ReturnType<typeof setTimeout> | null = null;

  const runKeepalive = async () => {
    const adapter = getDbAdapter();
    if (!adapter) {
      keepaliveTimerId = setTimeout(runKeepalive, KEEPALIVE_NORMAL_MS);
      if (keepaliveTimerId && typeof keepaliveTimerId === "object" && "unref" in keepaliveTimerId) keepaliveTimerId.unref();
      return;
    }

    let nextInterval = KEEPALIVE_NORMAL_MS;

    try {
      await adapter.get("SELECT 1");
      const failures = getConsecutiveKeepaliveFailures();
      if (failures > 0) {
        log.info(`Keepalive recovered after ${failures} failure(s)`);
      }
      setConsecutiveKeepaliveFailures(0);
    } catch (err) {
      setConsecutiveKeepaliveFailures(getConsecutiveKeepaliveFailures() + 1);
      nextInterval = KEEPALIVE_RECOVERY_MS;
      log.warn(`Keepalive ping failed`, {
        consecutive: getConsecutiveKeepaliveFailures(),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Also probe fast if circuit is open
    if ("isCircuitOpen" in adapter && typeof (adapter as { isCircuitOpen: () => boolean }).isCircuitOpen === "function") {
      if ((adapter as { isCircuitOpen: () => boolean }).isCircuitOpen()) {
        nextInterval = KEEPALIVE_RECOVERY_MS;
      }
    }

    keepaliveTimerId = setTimeout(runKeepalive, nextInterval);
    if (keepaliveTimerId && typeof keepaliveTimerId === "object" && "unref" in keepaliveTimerId) keepaliveTimerId.unref();
  };

  keepaliveTimerId = setTimeout(runKeepalive, KEEPALIVE_NORMAL_MS);
  if (keepaliveTimerId && typeof keepaliveTimerId === "object" && "unref" in keepaliveTimerId) keepaliveTimerId.unref();

  // --- Periodic stale-job check ---
  const STALE_JOB_CHECK_MS = 10 * 60_000;
  const { safeInterval } = await import("./utils/timers.js");
  safeInterval(async () => {
    try {
      const db = await getDb();
      const staleJob = await db.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM work_queue
         WHERE status = 'pending'
         AND created_at < datetime('now', '-5 minutes')`,
        []
      );
      if (staleJob && staleJob.cnt > 0) {
        log.info(`${staleJob.cnt} stale job(s) in queue, spawning worker`);
        spawnWorkerIfNeeded();
      }
    } catch (e) {
      silentCatch("mcp:stale-job-check")(e);
    }
  }, STALE_JOB_CHECK_MS);

  // Register cleanup and signal handlers
  onShutdown(() => autoEndSession());
  installSignalHandlers();
}

main().catch((error) => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
