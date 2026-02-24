#!/usr/bin/env bun

/**
 * Muninn — MCP Server v4 (In-Process)
 *
 * Calls core functions directly instead of spawning CLI processes.
 * Eliminates ~55 HTTP round-trips of overhead per tool call.
 *
 * Hybrid tool approach:
 * - 11 core tools with full schemas (frequently used, benefit from validation)
 * - 1 passthrough tool for whitelisted commands (saves ~8k tokens)
 *
 * Security:
 * - Input validation via Zod schemas
 * - Command whitelist for passthrough tool
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
  QueryInput,
  CheckInput,
  FileAddInput,
  DecisionAddInput,
  LearnAddInput,
  IssueInput,
  SessionInput,
  PredictInput,
  SuggestInput,
  EnrichInput,
  ApproveInput,
  ContextInput,
  IntentInput,
  PassthroughInput,
  SafePassthroughArg,
  validateInput,
} from "./mcp-validation.js";
import { createToolCallTimer } from "./ingestion/tool-logger.js";
import { queueFileUpdate } from "./ingestion/auto-file-update.js";
import { detectErrors, recordErrors } from "./ingestion/error-detector.js";
import { getActiveSessionId } from "./commands/session-tracking.js";
import { analyzeTask, getTaskContext, setTaskContext } from "./context/task-analyzer.js";
import {
  recordToolCall,
  checkAndUpdateFocus,
  shouldRefreshContext,
  recordFileAccess,
  resetQuality,
  setContextFiles,
} from "./context/shifter.js";
import { warmCache } from "./context/embedding-cache.js";
import { onShutdown, installSignalHandlers, shutdown } from "./utils/shutdown.js";
import { safeInterval } from "./utils/timers.js";
import { normalizePath, normalizePaths } from "./utils/paths.js";
import {
  handleQuery,
  handleCheck,
  handleFileAdd,
  handleDecisionAdd,
  handleLearnAdd,
  handleIssueAdd,
  handleIssueResolve,
  handleSessionStart,
  handleSessionEnd,
  handlePredict,
  handleSuggest,
  handleEnrich,
  handleApprove,
  handleContext,
  handleIntent,
  handlePassthrough,
} from "./mcp-handlers.js";
import { createLogger } from "./lib/logger.js";

// --- Extracted modules ---
import {
  getDb,
  getProjectId,
  getSessionState,
  getDbAdapter,
  getConsecutiveKeepaliveFailures,
  setConsecutiveKeepaliveFailures,
  getConsecutiveSlowCalls,
  setConsecutiveSlowCalls,
  getExceptionWindow,
  EXCEPTION_WINDOW_MS,
  MAX_EXCEPTIONS_IN_WINDOW,
  isExpectedException,
  getSessionAutoStarted,
  setSessionAutoStarted,
  getTaskAnalyzed,
  setTaskAnalyzed,
  getEmbeddingCacheWarmed,
  setEmbeddingCacheWarmed,
  getBudgetWeightsLoaded,
  setBudgetWeightsLoaded,
  setCachedBudgetWeights,
  setCachedBudgetOverrides,
  buildCalibratedContext,
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
  { name: "muninn", version: "7.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// ============================================================================
// Tool Definitions - 11 Core + 1 Passthrough
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOL_DEFINITIONS };
});

// ============================================================================
// Tool Handlers — In-Process
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = args as Record<string, unknown>;
  const cwd = (typedArgs.cwd as string) || process.cwd();

  log.debug(`Tool: ${name}`, { tool: name, args });

  // --- v4: Timer created early so catch block can access it ---
  let timer: ReturnType<typeof createToolCallTimer> | null = null;

  try {
    // Initialize shared DB adapter (cached after first call)
    const db = await getDb();
    const projectId = await getProjectId(db, cwd);

    // --- v4: Tool call timer (fire-and-forget logging) ---
    timer = createToolCallTimer(db, projectId, name, typedArgs);

    // --- v4 Phase 3: Context shifter — track tool calls for focus detection ---
    recordToolCall(name, typedArgs);

    // --- v5: Track file accesses for context quality ---
    const fileFields = ["path", "file_path"];
    for (const field of fileFields) {
      const val = typedArgs[field];
      if (typeof val === "string") recordFileAccess(val);
    }

    // --- v5 Phase 3/5: Task analyzer — run on first tool call + quality-driven refresh ---
    const taskAnalyzed = getTaskAnalyzed();
    const needsAnalysis = (!taskAnalyzed && name !== "muninn_session") || shouldRefreshContext();
    if (needsAnalysis) {
      const isRefresh = taskAnalyzed;
      setTaskAnalyzed(true);
      if (isRefresh) resetQuality();
      try {
        analyzeTask(db, projectId, name, typedArgs)
          .then((ctx) => {
            setTaskContext(ctx);
            // Persist task_type to session row (fire-and-forget, first-write-wins)
            if (ctx.taskType !== "unknown") {
              getActiveSessionId(db, projectId)
                .then((sid) => {
                  if (sid) db.run(
                    "UPDATE sessions SET task_type = ? WHERE id = ? AND task_type IS NULL",
                    [ctx.taskType, sid],
                  ).catch(() => {});
                })
                .catch(() => {});
            }
            // Track context files for quality monitoring
            setContextFiles(ctx.relevantFiles.map((f) => f.path));
            const output = buildCalibratedContext(ctx, 800);
            if (output) {
              getSessionState(cwd).writeContext(output);
            }
          })
          .catch(() => {});
      } catch { /* guard sync throw */ }
    }

    // --- v4 Phase 3: Context shifter — auto-update focus if topic shifted ---
    try {
      checkAndUpdateFocus(db, projectId)
        .then((shifted) => {
          if (shifted) {
            resetQuality();
            try {
              analyzeTask(db, projectId, name, typedArgs)
                .then((ctx) => {
                  setTaskContext(ctx);
                  setContextFiles(ctx.relevantFiles.map((f) => f.path));
                  const output = buildCalibratedContext(ctx, 800);
                  if (output) {
                    getSessionState(cwd).writeContext(output);
                  }
                })
                .catch(() => {});
            } catch { /* guard sync throw */ }
          }
        })
        .catch(() => {});
    } catch { /* guard sync throw */ }

    // --- v7 Loop Closure: Trajectory-driven context refresh ---
    // When stuck/failing pattern detected, force a context refresh
    try {
      const { getRecentToolNames } = await import("./context/shifter.js");
      const recentTools = getRecentToolNames();
      if (recentTools.length >= 5) {
        const { analyzeTrajectory } = await import("./context/trajectory-analyzer.js");
        const callData = recentTools.map((t) => ({ toolName: t, files: [] }));
        const trajectory = analyzeTrajectory(callData);
        if ((trajectory.pattern === "stuck" || trajectory.pattern === "failing") &&
            trajectory.confidence > 0.6 && !shouldRefreshContext()) {
          resetQuality(); // Force a refresh on next tool call
        }
      }
    } catch { /* guard sync throw */ }

    // --- v4: Session auto-start on first tool call ---
    if (!getSessionAutoStarted()) {
      setSessionAutoStarted(true);
      const state = getSessionState(cwd);
      state.clear();
      // Check if project has any file knowledge — skip enforcement for new projects
      const fileCount = await db.get<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM files WHERE project_id = ?",
        [projectId]
      );
      state.writeDiscoveryFile({ hasFileData: (fileCount?.cnt ?? 0) > 0 });
      try {
        autoStartSession(db, projectId).catch(() => {});
      } catch { /* guard sync throw */ }
      // Load budget weights and overrides for this session
      if (!getBudgetWeightsLoaded()) {
        setBudgetWeightsLoaded(true);
        try {
          import("./outcomes/confidence-calibrator.js")
            .then((mod) => mod.getWeightAdjustments(db, projectId))
            .then((weights) => { setCachedBudgetWeights(weights); })
            .catch(() => {});
        } catch { /* guard sync throw */ }
        try {
          import("./context/budget-manager.js")
            .then((mod) => mod.loadBudgetOverrides(db, projectId))
            .then((overrides) => { setCachedBudgetOverrides(overrides); })
            .catch(() => {});
        } catch { /* guard sync throw */ }
      }
      // v5 Phase 3: Warm embedding cache for hybrid semantic retrieval
      if (!getEmbeddingCacheWarmed()) {
        setEmbeddingCacheWarmed(true);
        try {
          warmCache(db, projectId).catch(() => {});
        } catch { /* guard sync throw */ }
      }
    }

    let result: string;

    switch (name) {
      // ========== CORE TOOLS ==========

      case "muninn_query": {
        const validation = validateInput(QueryInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        result = await handleQuery(db, projectId, validation.data);
        break;
      }

      case "muninn_check": {
        const validation = validateInput(CheckInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        validation.data.files = normalizePaths(cwd, validation.data.files);
        result = await handleCheck(db, projectId, validation.data.cwd || cwd, validation.data);
        // Track checked files for enforcement hook
        getSessionState(cwd).markChecked(validation.data.files);
        break;
      }

      case "muninn_file_add": {
        const validation = validateInput(FileAddInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        validation.data.path = normalizePath(cwd, validation.data.path);
        result = await handleFileAdd(db, projectId, validation.data);
        break;
      }

      case "muninn_decision_add": {
        const validation = validateInput(DecisionAddInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        result = await handleDecisionAdd(db, projectId, validation.data);
        break;
      }

      case "muninn_learn_add": {
        const validation = validateInput(LearnAddInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        result = await handleLearnAdd(db, projectId, validation.data);
        break;
      }

      case "muninn_issue": {
        const validation = validateInput(IssueInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const data = validation.data;
        if (data.action === "add") {
          result = await handleIssueAdd(db, projectId, data);
        } else {
          result = await handleIssueResolve(db, data);
        }
        break;
      }

      case "muninn_session": {
        const validation = validateInput(SessionInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const data = validation.data;
        const workingCwd = data.cwd || cwd;
        if (data.action === "start") {
          result = await handleSessionStart(db, projectId, data, workingCwd);
        } else {
          result = await handleSessionEnd(db, projectId, data);
        }
        break;
      }

      case "muninn_predict": {
        const validation = validateInput(PredictInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        if (validation.data.files) {
          validation.data.files = normalizePaths(cwd, validation.data.files);
        }
        result = await handlePredict(db, projectId, validation.data);
        break;
      }

      case "muninn_suggest": {
        const validation = validateInput(SuggestInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        result = await handleSuggest(db, projectId, validation.data);
        break;
      }

      case "muninn_enrich": {
        const validation = validateInput(EnrichInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        // Normalize file paths inside the JSON input string
        try {
          const parsed = JSON.parse(validation.data.input);
          if (parsed.file_path) {
            parsed.file_path = normalizePath(cwd, parsed.file_path);
            validation.data.input = JSON.stringify(parsed);
          }
        } catch {
          // Not valid JSON or no file_path — pass through unchanged
        }
        result = await handleEnrich(db, projectId, validation.data.cwd || cwd, validation.data);
        break;
      }

      case "muninn_approve": {
        const validation = validateInput(ApproveInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        result = await handleApprove(db, validation.data);
        break;
      }

      // ========== v7: UNIFIED CONTEXT ==========

      case "muninn_context": {
        const validation = validateInput(ContextInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        if (validation.data.files) {
          validation.data.files = normalizePaths(cwd, validation.data.files);
        }
        result = await handleContext(db, projectId, validation.data.cwd || cwd, validation.data);
        // Track checked files for enforcement hook (edit intent)
        if (validation.data.intent === "edit" && validation.data.files) {
          getSessionState(cwd).markChecked(validation.data.files);
        }
        break;
      }

      // ========== v7: MULTI-AGENT INTENT ==========

      case "muninn_intent": {
        const validation = validateInput(IntentInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        if (validation.data.action === "declare" && validation.data.files) {
          validation.data.files = normalizePaths(cwd, validation.data.files);
        }
        const sessionId = await getActiveSessionId(db, projectId);
        result = await handleIntent(db, projectId, sessionId, validation.data);
        break;
      }

      // ========== PASSTHROUGH ==========

      case "muninn": {
        const validation = validateInput(PassthroughInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { command } = validation.data;

        const parsedArgs = parseCommandArgs(command);
        if (parsedArgs.length === 0) throw new Error("Empty command");

        const subcommand = parsedArgs[0].toLowerCase();
        if (!ALLOWED_PASSTHROUGH_COMMANDS.has(subcommand)) {
          throw new Error(
            `Command "${subcommand}" not allowed via passthrough. Use dedicated tools for: query, check, file, decision, learn, issue, session, predict, suggest, enrich, approve. Allowed passthrough commands: ${[...ALLOWED_PASSTHROUGH_COMMANDS].sort().join(", ")}`
          );
        }

        // Validate each argument for shell metacharacters
        for (let i = 1; i < parsedArgs.length; i++) {
          const argResult = SafePassthroughArg.safeParse(parsedArgs[i]);
          if (!argResult.success) {
            throw new Error(
              `Invalid argument at position ${i}: ${argResult.error.errors[0]?.message || "validation failed"}`
            );
          }
        }

        const passthroughCwd = validation.data.cwd || cwd;
        result = await handlePassthrough(db, projectId, passthroughCwd, subcommand, parsedArgs.slice(1));
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // --- v4: Log successful tool call ---
    const durationMs = timer.finish(true);

    // --- v4: Slow-call monitoring ---
    const SLOW_THRESHOLD_MS = 5_000;
    const SLOW_WARNING_THRESHOLD = 3;
    if (durationMs !== undefined && durationMs > SLOW_THRESHOLD_MS) {
      setConsecutiveSlowCalls(getConsecutiveSlowCalls() + 1);
    } else {
      setConsecutiveSlowCalls(0);
    }

    // --- v4 Phase 3: Auto-append task context to read-oriented responses ---
    const READ_TOOLS = new Set([
      "muninn_query", "muninn_check", "muninn_predict",
      "muninn_suggest", "muninn_enrich", "muninn_context",
    ]);
    if (READ_TOOLS.has(name)) {
      const taskCtx = getTaskContext();
      if (taskCtx) {
        const contextBlock = buildCalibratedContext(taskCtx, 800);
        if (contextBlock && contextBlock.length < 4000) {
          result += `\n\n--- Task Context ---\n${contextBlock}`;
        }
      }
    }

    // --- v4: Auto-update file knowledge for Edit/Write-like tools ---
    if (name === "muninn_file_add" && typeof typedArgs.path === "string") {
      queueFileUpdate(projectId, typedArgs.path as string);
    }

    // --- v4: Detect errors in passthrough Bash-like output ---
    if (name === "muninn" && result) {
      try {
        const errors = detectErrors(result);
        if (errors.length > 0) {
          getActiveSessionId(db, projectId)
            .then((sessionId) => recordErrors(db, projectId, sessionId, null, errors))
            .catch(() => {});
        }
      } catch { /* guard sync throw */ }
    }

    // --- v4: Prepend slow-call warning if consecutive threshold exceeded ---
    const currentSlowCalls = getConsecutiveSlowCalls();
    if (currentSlowCalls >= SLOW_WARNING_THRESHOLD) {
      result = `[Slow responses detected — ${currentSlowCalls} consecutive calls >5s — check sqld connectivity]\n\n${result}`;
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(errMsg, { tool: name });

    // --- v4: Log failed tool call (if timer was created) ---
    timer?.finish(false, errMsg);

    // Connection resilience is handled inside HttpAdapter (retries + circuit breaker).
    // Don't reset the adapter from here — it defeats the circuit breaker's protection
    // and causes expensive re-initialization. The circuit breaker will naturally
    // recover after its cooldown period.

    return {
      content: [{ type: "text", text: `Error: ${errMsg}` }],
      isError: true,
    };
  }
});

// ============================================================================
// v4 Phase 3: MCP Resources
// ============================================================================

registerResourceHandlers(server);

// ============================================================================
// Start Server
// ============================================================================

async function main(): Promise<void> {
  log.info("Starting Muninn MCP Server v7 (in-process)...");

  // --- Global error handlers: prevent silent crashes ---
  process.on("unhandledRejection", (reason) => {
    log.error(`Unhandled rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  });
  process.on("uncaughtException", (error) => {
    log.error(`Uncaught exception: ${error.stack || error.message}`);

    // Skip expected errors (validation, tool errors) — they don't indicate systemic failure
    if (isExpectedException(error)) {
      log.warn("Expected exception (not counted toward crash threshold)");
      return;
    }

    // Rate-limit: track exceptions in a sliding window
    const now = Date.now();
    const exceptionWindow = getExceptionWindow();
    exceptionWindow.push(now);
    // Evict entries older than the window
    while (exceptionWindow.length > 0 && exceptionWindow[0] < now - EXCEPTION_WINDOW_MS) {
      exceptionWindow.shift();
    }

    if (exceptionWindow.length >= MAX_EXCEPTIONS_IN_WINDOW) {
      log.error(`${exceptionWindow.length} exceptions in ${EXCEPTION_WINDOW_MS / 1000}s — systemic failure, exiting`);
      shutdown(1);
    } else {
      log.warn(`Exception survived (${exceptionWindow.length}/${MAX_EXCEPTIONS_IN_WINDOW} in window)`);
    }
  });

  // --- Stdio pipe monitoring: detect broken pipes ---
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

    // Pre-warm a default project ID if we have a cwd
    const defaultCwd = process.cwd();
    await getProjectId(db, defaultCwd);
    log.info("Project ID cached", { cwd: defaultCwd });
  } catch (error) {
    log.warn(`DB pre-warm failed (will retry on first tool call): ${error}`);
  }

  // --- MCP server error/close handlers (set BEFORE connect to avoid race) ---
  server.onerror = (error) => {
    log.error(`MCP server error: ${error instanceof Error ? error.message : String(error)}`);
    // Don't crash on server errors — they're recoverable
  };
  server.onclose = () => {
    log.info("MCP server connection closed — checking if stdin is still open");
    // Only shutdown if stdin is truly dead. The MCP SDK may fire onclose
    // transiently during reconnection.
    if (process.stdin.destroyed || process.stdin.readableEnded) {
      log.info("stdin is dead — shutting down");
      shutdown(0);
    } else {
      log.warn("onclose fired but stdin still alive — staying up for potential reconnect");
    }
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP-native session ready — session auto-start/end works for any MCP client");

  // Write PID file for watchdog detection
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/muninn-mcp.pid", String(process.pid));
  } catch {
    // Non-critical
  }

  // --- Database keepalive: prevent connection staleness ---
  // Ping every 5 minutes. Monitor-only — the adapter's circuit breaker
  // handles recovery. Keepalive just keeps the connection warm.
  const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  safeInterval(async () => {
    const adapter = getDbAdapter();
    if (!adapter) return; // No adapter yet
    try {
      await adapter.get("SELECT 1");
      const failures = getConsecutiveKeepaliveFailures();
      if (failures > 0) {
        log.info(`Keepalive recovered after ${failures} failure(s)`);
      }
      setConsecutiveKeepaliveFailures(0);
    } catch (err) {
      setConsecutiveKeepaliveFailures(getConsecutiveKeepaliveFailures() + 1);
      log.warn(`Keepalive ping failed`, { consecutive: getConsecutiveKeepaliveFailures(), error: err instanceof Error ? err.message : String(err) });
    }
  }, KEEPALIVE_INTERVAL_MS);

  // --- v7 Phase 5A: Expire stale agent intents every 5 minutes ---
  const INTENT_EXPIRE_MS = 5 * 60_000; // 5 minutes
  safeInterval(async () => {
    try {
      const db = await getDb();
      const defaultProject = await getProjectId(db, process.cwd());
      const { expireIntents } = await import("./agents/intent-manager.js");
      await expireIntents(db, defaultProject);
    } catch {
      // Best-effort — tables may not exist
    }
  }, INTENT_EXPIRE_MS);

  // --- Periodic stale-job check: spawn worker if jobs are stuck ---
  const STALE_JOB_CHECK_MS = 10 * 60_000; // 10 minutes
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
    } catch {
      // Best-effort — work_queue might not exist
    }
  }, STALE_JOB_CHECK_MS);

  // Register cleanup and signal handlers via shutdown manager
  onShutdown(() => autoEndSession());
  installSignalHandlers();
}

main().catch((error) => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
