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
import { buildContextOutput } from "./context/budget-manager.js";
import { recordToolCall, checkAndUpdateFocus } from "./context/shifter.js";
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

function log(msg: string): void {
  process.stderr.write(`[muninn-mcp] ${msg}\n`);
}

// ============================================================================
// Shared State (initialized once at server startup)
// ============================================================================

let dbAdapter: DatabaseAdapter | null = null;
const projectIdCache = new Map<string, number>();

/**
 * Get or initialize the shared database adapter.
 * Only creates one connection for the lifetime of the MCP server process.
 */
async function getDb(): Promise<DatabaseAdapter> {
  if (dbAdapter) return dbAdapter;

  const { getGlobalDb } = await import("./database/connection");
  dbAdapter = await getGlobalDb();
  return dbAdapter;
}

/**
 * Get or cache the project ID for a given working directory.
 */
async function getProjectId(db: DatabaseAdapter, cwd: string): Promise<number> {
  const cached = projectIdCache.get(cwd);
  if (cached !== undefined) return cached;

  const { ensureProject } = await import("./database/connection");
  const projectId = await ensureProject(db, cwd);
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

    // --- v4 Phase 3: Task analyzer — run on first meaningful tool call ---
    if (!taskAnalyzed && name !== "muninn_session") {
      taskAnalyzed = true;
      analyzeTask(db, projectId, name, typedArgs)
        .then((ctx) => setTaskContext(ctx))
        .catch(() => {});
    }

    // --- v4 Phase 3: Context shifter — auto-update focus if topic shifted ---
    checkAndUpdateFocus(db, projectId).catch(() => {});

    // --- v4: Session auto-start on first tool call ---
    if (!sessionAutoStarted) {
      sessionAutoStarted = true;
      autoStartSession(db, projectId).catch(() => {});
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
        result = await handleCheck(db, projectId, validation.data.cwd || cwd, validation.data);
        break;
      }

      case "muninn_file_add": {
        const validation = validateInput(FileAddInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
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
    timer.finish(true);

    // --- v4: Auto-update file knowledge for Edit/Write-like tools ---
    if (name === "muninn_file_add" && typeof typedArgs.path === "string") {
      queueFileUpdate(projectId, typedArgs.path as string);
    }

    // --- v4: Detect errors in passthrough Bash-like output ---
    if (name === "muninn" && result) {
      const errors = detectErrors(result);
      if (errors.length > 0) {
        getActiveSessionId(db, projectId)
          .then((sessionId) => recordErrors(db, projectId, sessionId, null, errors))
          .catch(() => {});
      }
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    log(`Error: ${error}`);

    // --- v4: Log failed tool call (if timer was created) ---
    timer?.finish(false, error instanceof Error ? error.message : String(error));

    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
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
      const output = buildContextOutput(taskCtx);
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server connected via stdio");

  // v4: Register signal handlers for session auto-end
  // Hard timeout ensures process exits even if autoEndSession hangs
  const handleShutdown = () => {
    const forceExit = setTimeout(() => process.exit(0), 5000);
    if (typeof forceExit === "object" && "unref" in forceExit) forceExit.unref();
    autoEndSession()
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);
}

main().catch((error) => {
  log(`Fatal error: ${error}`);
  process.exit(1);
});
