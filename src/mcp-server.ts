#!/usr/bin/env bun

/**
 * Muninn — MCP Server v3 (In-Process)
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
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
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
  PassthroughInput,
  SafePassthroughArg,
  validateInput,
} from "./mcp-validation.js";
import type { DatabaseAdapter } from "./database/adapter";
import { createToolCallTimer } from "./ingestion/tool-logger.js";
import { queueFileUpdate } from "./ingestion/auto-file-update.js";
import { detectErrors, recordErrors } from "./ingestion/error-detector.js";
import { getActiveSessionId } from "./commands/session-tracking.js";
import { analyzeTask, getTaskContext, setTaskContext } from "./context/task-analyzer.js";
import { buildContextOutput, applyWeightAdjustments } from "./context/budget-manager.js";
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
  handlePassthrough,
} from "./mcp-handlers.js";
import { SessionState } from "./session-state.js";

function log(msg: string): void {
  process.stderr.write(`[muninn-mcp] ${msg}\n`);
}

// ============================================================================
// Shared State (initialized once at server startup)
// ============================================================================

let dbAdapter: DatabaseAdapter | null = null;
const projectIdCache = new Map<string, number>();
let sessionState: SessionState | null = null;
let consecutiveKeepaliveFailures = 0;
let consecutiveSlowCalls = 0;

// Rate-limited exception tracking: survive sporadic exceptions, die on systemic failure
const exceptionWindow: number[] = [];
const EXCEPTION_WINDOW_MS = 60_000;
const MAX_EXCEPTIONS_IN_WINDOW = 10;

// Exceptions that don't count toward the crash threshold
function isExpectedException(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return msg.includes("validation") ||
    msg.includes("invalid params") ||
    msg.includes("not found") ||
    msg.includes("circuit breaker open") ||
    msg.includes("must be called before");
}

// Lazily loaded connection module (cached after first import)
let connModule: typeof import("./database/connection") | null = null;

async function loadConnectionModule() {
  if (!connModule) {
    connModule = await import("./database/connection");
  }
  return connModule;
}

function getSessionState(cwd: string): SessionState {
  if (!sessionState) {
    sessionState = new SessionState(cwd);
  }
  return sessionState;
}

/**
 * Get or initialize the shared database adapter.
 * Creates one connection and reuses it for the process lifetime.
 * The HttpAdapter handles all connection resilience internally
 * (retries + circuit breaker) — we never reset it from outside.
 */
async function getDb(): Promise<DatabaseAdapter> {
  if (dbAdapter) return dbAdapter;

  const conn = await loadConnectionModule();
  dbAdapter = await conn.getGlobalDb();
  consecutiveKeepaliveFailures = 0;
  return dbAdapter;
}

/**
 * Get or cache the project ID for a given working directory.
 */
async function getProjectId(db: DatabaseAdapter, cwd: string): Promise<number> {
  const cached = projectIdCache.get(cwd);
  if (cached !== undefined) return cached;

  const conn = await loadConnectionModule();
  const projectId = await conn.ensureProject(db, cwd);
  projectIdCache.set(cwd, projectId);
  return projectId;
}

// ============================================================================
// Command Whitelist for Passthrough Tool
// ============================================================================

const ALLOWED_PASSTHROUGH_COMMANDS = new Set([
  "status",
  "fragile",
  "brief",
  "resume",
  "outcome",
  "insights",
  "bookmark",
  "bm",
  "focus",
  "observe",
  "obs",
  "debt",
  "pattern",
  "stack",
  "temporal",
  "profile",
  "workflow",
  "wf",
  "foundational",
  "correlations",
  "git-info",
  "sync-hashes",
  "drift",
  "conflicts",
  "deps",
  "blast",
  "db",
  "smart-status",
  "ss",
  "ingest",
  "install-hook",
]);

/**
 * Parse command string into argument array without shell interpretation.
 * Handles quoted strings safely.
 */
function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of command) {
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

const server = new Server(
  { name: "muninn", version: "4.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// Track whether session has been auto-started for this process lifetime
let sessionAutoStarted = false;
// Track whether initial task analysis has been done
let taskAnalyzed = false;
// Track whether embedding cache has been warmed
let embeddingCacheWarmed = false;
// Worker spawn rate-limiting
let lastWorkerSpawnAt = 0;
const WORKER_SPAWN_COOLDOWN_MS = 5 * 60_000; // 5 minutes
// Cached budget weights from confidence calibrator
let cachedBudgetWeights: Record<string, number> = {};
let budgetWeightsLoaded = false;

/** Build context output with calibrated budget weights applied */
function buildCalibratedContext(ctx: import("./context/task-analyzer").TaskContext, budget?: number): string {
  const defaultAlloc = {
    contradictions: 300, criticalWarnings: 350, decisions: 350,
    learnings: 350, fileContext: 350, errorFixes: 150, reserve: 150,
  };
  const adjusted = applyWeightAdjustments(defaultAlloc, cachedBudgetWeights);
  return buildContextOutput(ctx, budget, adjusted);
}

// ============================================================================
// Tool Definitions - 11 Core + 1 Passthrough
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ========== CORE TOOLS (full schemas) ==========

      {
        name: "muninn_query",
        description: "Search project memory (decisions, issues, learnings, files). Use before changes.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            smart: { type: "boolean", description: "LLM re-ranking" },
            vector: { type: "boolean", description: "Semantic similarity only" },
            fts: { type: "boolean", description: "Full-text search only" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["query"],
        },
      },

      {
        name: "muninn_check",
        description: "Pre-edit warnings (fragility, issues, staleness). MANDATORY before editing.",
        inputSchema: {
          type: "object",
          properties: {
            files: { type: "array", items: { type: "string" }, description: "Files to check" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["files"],
        },
      },

      {
        name: "muninn_file_add",
        description: "Record file knowledge. Call after modifying files.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
            purpose: { type: "string", description: "What this file does" },
            fragility: { type: "number", description: "1-10 danger score" },
            fragility_reason: { type: "string", description: "Why fragile" },
            type: { type: "string", description: "component, util, config, etc." },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["path", "purpose", "fragility"],
        },
      },

      {
        name: "muninn_decision_add",
        description: "Record architectural decision for future reference.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title" },
            decision: { type: "string", description: "What was decided" },
            reasoning: { type: "string", description: "Why this choice" },
            affects: { type: "string", description: "JSON array of file paths" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["title", "decision", "reasoning"],
        },
      },

      {
        name: "muninn_learn_add",
        description: "Record learning/pattern/gotcha for future sessions.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title" },
            content: { type: "string", description: "The learning" },
            category: { type: "string", description: "pattern, gotcha, preference, convention" },
            context: { type: "string", description: "When this applies" },
            global: { type: "boolean", description: "Apply to all projects" },
            files: { type: "string", description: "JSON array of related files" },
            foundational: { type: "boolean", description: "Mark as foundational (reviewed every 30 sessions)" },
            reviewAfter: { type: "number", description: "Custom review interval (sessions, default 30)" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["title", "content"],
        },
      },

      {
        name: "muninn_issue",
        description: "Manage issues. Actions: add (record bug), resolve (mark fixed).",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "resolve"], description: "add or resolve" },
            // For add:
            title: { type: "string", description: "Issue title (for add)" },
            description: { type: "string", description: "Details (for add)" },
            severity: { type: "number", description: "1-10 (for add)" },
            type: { type: "string", description: "bug, potential, security, performance" },
            // For resolve:
            id: { type: "number", description: "Issue ID (for resolve)" },
            resolution: { type: "string", description: "How resolved (for resolve)" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["action"],
        },
      },

      {
        name: "muninn_session",
        description: "Manage sessions. Actions: start (begin tracking), end (save outcome).",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["start", "end"], description: "start or end" },
            goal: { type: "string", description: "Session goal (for start)" },
            outcome: { type: "string", description: "What was done (for end)" },
            next_steps: { type: "string", description: "What to do next (for end)" },
            success: { type: "number", description: "0=failed, 1=partial, 2=success" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["action"],
        },
      },

      {
        name: "muninn_predict",
        description:
          "Bundle all context for a task: files, co-changers, decisions, issues, learnings. Uses FTS (keyword matching). Use --advise for planning recommendations.",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string", description: "Task description" },
            files: { type: "array", items: { type: "string" }, description: "Files involved" },
            advise: {
              type: "boolean",
              description: "Generate planning advisory with risk assessment and recommendations",
            },
            cwd: { type: "string", description: "Working directory" },
          },
          required: [],
        },
      },

      {
        name: "muninn_suggest",
        description:
          "Suggest files for a task using semantic search. Finds conceptually related files (e.g., 'fix auth bug' finds login, session, token files).",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string", description: "Task description to find relevant files" },
            limit: { type: "number", description: "Max results (default: 10)" },
            includeSymbols: { type: "boolean", description: "Also search functions/classes" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["task"],
        },
      },

      {
        name: "muninn_enrich",
        description:
          "Auto-inject context for a tool call. Returns file fragility, decisions, learnings, issues, blast radius, and related files. Use this before Read/Edit/Write operations to get relevant context automatically.",
        inputSchema: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              enum: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
              description: "Tool being called (Read, Edit, Write, Bash, etc.)",
            },
            input: { type: "string", description: "Tool input (JSON string)" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["tool", "input"],
        },
      },

      {
        name: "muninn_approve",
        description:
          "Approve a blocked operation. Required when editing high-fragility files (fragility >= 9). Use the operation ID from the blocked message.",
        inputSchema: {
          type: "object",
          properties: {
            operationId: { type: "string", description: "Operation ID from blocked message (e.g., op_abc123)" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["operationId"],
        },
      },

      // ========== PASSTHROUGH TOOL ==========

      {
        name: "muninn",
        description: `Run any muninn CLI command. Examples:
- muninn "status" — project state
- muninn "fragile" — list fragile files
- muninn "outcome record 5 succeeded" — record decision outcome
- muninn "insights list" — view insights
- muninn "insights ack 3" — acknowledge insight
- muninn "bookmark add --label x --content y"
- muninn "focus set --area auth"
- muninn "observe 'pattern noticed'"
See CLAUDE.md for full command reference.`,
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "CLI command (without 'muninn' prefix)" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: ["command"],
        },
      },
    ],
  };
});

// ============================================================================
// Tool Handlers — In-Process
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = args as Record<string, unknown>;
  const cwd = (typedArgs.cwd as string) || process.cwd();

  log(`Tool: ${name} args: ${JSON.stringify(args)}`);

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
    const needsAnalysis = (!taskAnalyzed && name !== "muninn_session") || shouldRefreshContext();
    if (needsAnalysis) {
      const isRefresh = taskAnalyzed;
      taskAnalyzed = true;
      if (isRefresh) resetQuality();
      try {
        analyzeTask(db, projectId, name, typedArgs)
          .then((ctx) => {
            setTaskContext(ctx);
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

    // --- v4: Session auto-start on first tool call ---
    if (!sessionAutoStarted) {
      sessionAutoStarted = true;
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
      // Load budget weights for this session
      if (!budgetWeightsLoaded) {
        budgetWeightsLoaded = true;
        try {
          import("./outcomes/confidence-calibrator.js")
            .then((mod) => mod.getWeightAdjustments(db, projectId))
            .then((weights) => { cachedBudgetWeights = weights; })
            .catch(() => {});
        } catch { /* guard sync throw */ }
      }
      // v5 Phase 3: Warm embedding cache for hybrid semantic retrieval
      if (!embeddingCacheWarmed) {
        embeddingCacheWarmed = true;
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
      consecutiveSlowCalls++;
    } else {
      consecutiveSlowCalls = 0;
    }

    // --- v4 Phase 3: Auto-append task context to read-oriented responses ---
    const READ_TOOLS = new Set([
      "muninn_query", "muninn_check", "muninn_predict",
      "muninn_suggest", "muninn_enrich",
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
    if (consecutiveSlowCalls >= SLOW_WARNING_THRESHOLD) {
      result = `[Slow responses detected — ${consecutiveSlowCalls} consecutive calls >5s — check sqld connectivity]\n\n${result}`;
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`Error: ${errMsg}`);

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

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "muninn://context/current",
        name: "Current Task Context",
        description: "Task-relevant context computed from recent tool calls. Re-computed on each read.",
        mimeType: "text/plain",
      },
      {
        uri: "muninn://context/errors",
        name: "Recent Errors with Known Fixes",
        description: "Recent error events with linked fixes from error-fix pair mapping.",
        mimeType: "text/plain",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  try {
    const db = await getDb();
    const defaultCwd = process.cwd();
    const projectId = await getProjectId(db, defaultCwd);

    if (uri === "muninn://context/current") {
      const taskCtx = getTaskContext();
      if (!taskCtx) {
        return { contents: [{ uri, mimeType: "text/plain", text: "No task context yet. Make a tool call first." }] };
      }
      const output = buildCalibratedContext(taskCtx);
      return { contents: [{ uri, mimeType: "text/plain", text: output || "No relevant context for current task." }] };
    }

    if (uri === "muninn://context/errors") {
      const errors = await db.all<{
        error_type: string; message: string; file_path: string | null; created_at: string;
      }>(
        `SELECT error_type, message, file_path, created_at FROM error_events
         WHERE project_id = ? ORDER BY created_at DESC LIMIT 10`,
        [projectId]
      );

      if (errors.length === 0) {
        return { contents: [{ uri, mimeType: "text/plain", text: "No recent errors." }] };
      }

      const lines = ["Recent errors:"];
      for (const e of errors) {
        const file = e.file_path ? ` in ${e.file_path}` : "";
        lines.push(`  [${e.error_type}]${file}: ${e.message.slice(0, 80)}`);
      }

      // Include known fixes
      const fixes = await db.all<{
        error_signature: string; fix_description: string; confidence: number;
      }>(
        `SELECT error_signature, fix_description, confidence FROM error_fix_pairs
         WHERE project_id = ? AND confidence >= 0.5
         ORDER BY last_seen_at DESC LIMIT 5`,
        [projectId]
      );

      if (fixes.length > 0) {
        lines.push("");
        lines.push("Known fixes:");
        for (const f of fixes) {
          lines.push(`  ${f.error_signature.slice(0, 30)} → ${(f.fix_description || "see commits").slice(0, 50)} (${Math.round(f.confidence * 100)}%)`);
        }
      }

      return { contents: [{ uri, mimeType: "text/plain", text: lines.join("\n") }] };
    }

    return { contents: [{ uri, mimeType: "text/plain", text: `Unknown resource: ${uri}` }] };
  } catch (error) {
    return {
      contents: [{ uri, mimeType: "text/plain", text: `Error reading resource: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
});

// ============================================================================
// v4: Session Auto-Start/End
// ============================================================================

/** Spawn the background worker if enough time has passed since last spawn */
function spawnWorkerIfNeeded(): void {
  const now = Date.now();
  if (now - lastWorkerSpawnAt < WORKER_SPAWN_COOLDOWN_MS) return;
  lastWorkerSpawnAt = now;

  try {
    const workerPath = new URL("./worker.ts", import.meta.url).pathname;
    const proc = Bun.spawn(["bun", "run", workerPath, "--once"], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env },
    });
    // Detach from parent — let worker run independently
    proc.unref();
    log("Spawned background worker");
  } catch (err) {
    log(`Failed to spawn worker: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Auto-start a session on first tool call if none is active */
async function autoStartSession(db: DatabaseAdapter, projectId: number): Promise<void> {
  try {
    const activeSession = await db.get<{ id: number }>(
      `SELECT id FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      [projectId]
    );
    if (activeSession) return; // Session already active

    const mod = await import("./commands/session.js");
    const { captureOutput } = await import("./mcp-handlers.js");
    await captureOutput(async () => { await mod.sessionStart(db, projectId, "Auto-started session"); });
    log("Auto-started session");
  } catch {
    // Non-critical — session tracking is best-effort
  }
}

/** Auto-end session on process termination */
async function autoEndSession(): Promise<void> {
  try {
    const db = await getDb();
    const defaultCwd = process.cwd();
    const projectId = await getProjectId(db, defaultCwd);

    const activeSession = await db.get<{ id: number }>(
      `SELECT id FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      [projectId]
    );
    if (!activeSession) return;

    // Get tool call summary for this session
    const toolSummary = await db.all<{ tool_name: string; cnt: number }>(
      `SELECT tool_name, COUNT(*) as cnt FROM tool_calls
       WHERE session_id = ? GROUP BY tool_name ORDER BY cnt DESC LIMIT 10`,
      [activeSession.id]
    );

    const summaryText = toolSummary.length > 0
      ? `Tools used: ${toolSummary.map((t) => `${t.tool_name} x${t.cnt}`).join(", ")}`
      : "No tool calls recorded";

    await db.run(
      `UPDATE sessions SET ended_at = datetime('now'), outcome = ? WHERE id = ?`,
      [summaryText, activeSession.id]
    );

    // v4 Phase 2: Queue background learning jobs for this session
    try {
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["map_error_fixes", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["detect_patterns", JSON.stringify({ projectId })]
      );
    } catch {
      // work_queue might not exist yet
    }

    // v4 Phase 5: Queue outcome intelligence jobs for this session
    try {
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["track_decisions", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["calibrate_confidence", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["process_context_feedback", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
      // v5 Phase 1: Reinforce learnings after context feedback
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["reinforce_learnings", JSON.stringify({ projectId, sessionId: activeSession.id })]
      );
    } catch {
      // work_queue might not exist yet
    }

    // v4 Phase 6: Queue team intelligence jobs at session end
    try {
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["aggregate_learnings", JSON.stringify({ projectId })]
      );
      await db.run(
        `INSERT INTO work_queue (job_type, payload) VALUES (?, ?)`,
        ["promote_reviews", JSON.stringify({ projectId })]
      );
    } catch {
      // work_queue might not exist yet
    }

    // Spawn worker to process queued jobs
    spawnWorkerIfNeeded();

    log("Auto-ended session");
  } catch {
    // Best-effort — process is exiting
  }
}

// ============================================================================
// Start Server
// ============================================================================

async function main(): Promise<void> {
  log("Starting Muninn MCP Server v4 (in-process)...");

  // --- Global error handlers: prevent silent crashes ---
  process.on("unhandledRejection", (reason) => {
    log(`Unhandled rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  });
  process.on("uncaughtException", (error) => {
    log(`Uncaught exception: ${error.stack || error.message}`);

    // Skip expected errors (validation, tool errors) — they don't indicate systemic failure
    if (isExpectedException(error)) {
      log("Expected exception (not counted toward crash threshold)");
      return;
    }

    // Rate-limit: track exceptions in a sliding window
    const now = Date.now();
    exceptionWindow.push(now);
    // Evict entries older than the window
    while (exceptionWindow.length > 0 && exceptionWindow[0] < now - EXCEPTION_WINDOW_MS) {
      exceptionWindow.shift();
    }

    if (exceptionWindow.length >= MAX_EXCEPTIONS_IN_WINDOW) {
      log(`${exceptionWindow.length} exceptions in ${EXCEPTION_WINDOW_MS / 1000}s — systemic failure, exiting`);
      shutdown(1);
    } else {
      log(`Exception survived (${exceptionWindow.length}/${MAX_EXCEPTIONS_IN_WINDOW} in window)`);
    }
  });

  // --- Stdio pipe monitoring: detect broken pipes ---
  process.stdin.on("error", (err) => {
    log(`stdin error: ${err.message}`);
  });
  process.stdout.on("error", (err) => {
    if (err && "code" in err && err.code === "EPIPE") {
      log("stdout pipe broken (parent disconnected)");
      shutdown(0);
    } else {
      log(`stdout error: ${err.message}`);
    }
  });
  process.stdin.on("end", () => {
    log("stdin ended (parent disconnected)");
    shutdown(0);
  });

  // Pre-warm the DB connection at startup
  try {
    const db = await getDb();
    log("Database adapter initialized");

    // Pre-warm a default project ID if we have a cwd
    const defaultCwd = process.cwd();
    await getProjectId(db, defaultCwd);
    log(`Project ID cached for ${defaultCwd}`);
  } catch (error) {
    log(`Warning: DB pre-warm failed (will retry on first tool call): ${error}`);
  }

  // --- MCP server error/close handlers (set BEFORE connect to avoid race) ---
  server.onerror = (error) => {
    log(`MCP server error: ${error instanceof Error ? error.message : String(error)}`);
  };
  server.onclose = () => {
    log("MCP server connection closed");
    shutdown(0);
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server connected via stdio");

  // --- Database keepalive: prevent connection staleness ---
  // Ping every 5 minutes. Monitor-only — the adapter's circuit breaker
  // handles recovery. Keepalive just keeps the connection warm.
  const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  safeInterval(async () => {
    if (!dbAdapter) return; // No adapter yet
    try {
      await dbAdapter.get("SELECT 1");
      if (consecutiveKeepaliveFailures > 0) {
        log(`Keepalive recovered after ${consecutiveKeepaliveFailures} failure(s)`);
      }
      consecutiveKeepaliveFailures = 0;
    } catch (err) {
      consecutiveKeepaliveFailures++;
      log(`Keepalive ping failed (${consecutiveKeepaliveFailures}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, KEEPALIVE_INTERVAL_MS);

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
        log(`${staleJob.cnt} stale job(s) in queue, spawning worker`);
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
  log(`Fatal error: ${error}`);
  process.exit(1);
});
