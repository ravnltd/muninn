/**
 * Remote MCP Endpoint
 *
 * Receives MCP requests over Streamable HTTP, resolves tenant from auth,
 * and routes to the same muninn tool handlers used locally.
 *
 * Uses WebStandardStreamableHTTPServerTransport for direct Hono/Bun compat.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { DatabaseAdapter } from "./types";
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
} from "../../src/mcp-validation.js";
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
} from "../../src/mcp-handlers.js";
import { getTenantDb } from "./tenants/pool";
import { incrementToolCallCount } from "./billing/metering";

// ============================================================================
// Session Management
// ============================================================================

interface McpSession {
  server: Server;
  transport: WebStandardStreamableHTTPServerTransport;
  tenantId: string;
  createdAt: number;
}

const sessions = new Map<string, McpSession>();

// Cleanup stale sessions every 30 minutes
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      session.transport.close();
      sessions.delete(id);
    }
  }
}, 30 * 60 * 1000);
if (typeof sessionCleanupTimer === "object" && "unref" in sessionCleanupTimer) sessionCleanupTimer.unref();

// ============================================================================
// Passthrough Whitelist (same as local MCP server)
// ============================================================================

const ALLOWED_PASSTHROUGH_COMMANDS = new Set([
  "status", "fragile", "brief", "resume", "outcome", "insights",
  "bookmark", "bm", "focus", "observe", "obs", "debt", "pattern",
  "stack", "temporal", "profile", "workflow", "wf", "foundational",
  "correlations", "smart-status", "ss",
  // Excluded: git-info, sync-hashes, drift, deps, blast, db (require filesystem)
]);

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

// ============================================================================
// Project ID Cache (per-tenant)
// ============================================================================

const projectIdCache = new Map<string, number>();

async function getProjectId(db: DatabaseAdapter, cwd: string): Promise<number> {
  const key = `${cwd}`;
  const cached = projectIdCache.get(key);
  if (cached !== undefined) return cached;

  const { ensureProject } = await import("../../src/database/connection");
  const projectId = await ensureProject(db, cwd);
  projectIdCache.set(key, projectId);
  return projectId;
}

// ============================================================================
// Tool Registration
// ============================================================================

function createServer(tenantId: string, db: DatabaseAdapter): Server {
  const server = new Server(
    { name: "muninn", version: "3.0.0" },
    { capabilities: { tools: {} } }
  );

  // Same tool definitions as local MCP server
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "muninn_query",
        description: "Search project memory (decisions, issues, learnings, files). Use before changes.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: { type: "string" as const, description: "Search query" },
            smart: { type: "boolean" as const, description: "LLM re-ranking" },
            vector: { type: "boolean" as const, description: "Semantic similarity only" },
            fts: { type: "boolean" as const, description: "Full-text search only" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["query"],
        },
      },
      {
        name: "muninn_check",
        description: "Pre-edit warnings (fragility, issues, staleness). MANDATORY before editing.",
        inputSchema: {
          type: "object" as const,
          properties: {
            files: { type: "array" as const, items: { type: "string" as const }, description: "Files to check" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["files"],
        },
      },
      {
        name: "muninn_file_add",
        description: "Record file knowledge. Call after modifying files.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: { type: "string" as const, description: "File path" },
            purpose: { type: "string" as const, description: "What this file does" },
            fragility: { type: "number" as const, description: "1-10 danger score" },
            fragility_reason: { type: "string" as const, description: "Why fragile" },
            type: { type: "string" as const, description: "component, util, config, etc." },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["path", "purpose", "fragility"],
        },
      },
      {
        name: "muninn_decision_add",
        description: "Record architectural decision for future reference.",
        inputSchema: {
          type: "object" as const,
          properties: {
            title: { type: "string" as const, description: "Short title" },
            decision: { type: "string" as const, description: "What was decided" },
            reasoning: { type: "string" as const, description: "Why this choice" },
            affects: { type: "string" as const, description: "JSON array of file paths" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["title", "decision", "reasoning"],
        },
      },
      {
        name: "muninn_learn_add",
        description: "Record learning/pattern/gotcha for future sessions.",
        inputSchema: {
          type: "object" as const,
          properties: {
            title: { type: "string" as const, description: "Short title" },
            content: { type: "string" as const, description: "The learning" },
            category: { type: "string" as const, description: "pattern, gotcha, preference, convention" },
            context: { type: "string" as const, description: "When this applies" },
            global: { type: "boolean" as const, description: "Apply to all projects" },
            files: { type: "string" as const, description: "JSON array of related files" },
            foundational: { type: "boolean" as const, description: "Mark as foundational" },
            reviewAfter: { type: "number" as const, description: "Custom review interval" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["title", "content"],
        },
      },
      {
        name: "muninn_issue",
        description: "Manage issues. Actions: add (record bug), resolve (mark fixed).",
        inputSchema: {
          type: "object" as const,
          properties: {
            action: { type: "string" as const, enum: ["add", "resolve"], description: "add or resolve" },
            title: { type: "string" as const, description: "Issue title (for add)" },
            description: { type: "string" as const, description: "Details (for add)" },
            severity: { type: "number" as const, description: "1-10 (for add)" },
            type: { type: "string" as const, description: "bug, potential, security, performance" },
            id: { type: "number" as const, description: "Issue ID (for resolve)" },
            resolution: { type: "string" as const, description: "How resolved (for resolve)" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["action"],
        },
      },
      {
        name: "muninn_session",
        description: "Manage sessions. Actions: start (begin tracking), end (save outcome).",
        inputSchema: {
          type: "object" as const,
          properties: {
            action: { type: "string" as const, enum: ["start", "end"], description: "start or end" },
            goal: { type: "string" as const, description: "Session goal (for start)" },
            outcome: { type: "string" as const, description: "What was done (for end)" },
            next_steps: { type: "string" as const, description: "What to do next (for end)" },
            success: { type: "number" as const, description: "0=failed, 1=partial, 2=success" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["action"],
        },
      },
      {
        name: "muninn_predict",
        description: "Bundle all context for a task: files, co-changers, decisions, issues, learnings.",
        inputSchema: {
          type: "object" as const,
          properties: {
            task: { type: "string" as const, description: "Task description" },
            files: { type: "array" as const, items: { type: "string" as const }, description: "Files involved" },
            advise: { type: "boolean" as const, description: "Generate planning advisory" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: [],
        },
      },
      {
        name: "muninn_suggest",
        description: "Suggest files for a task using semantic search.",
        inputSchema: {
          type: "object" as const,
          properties: {
            task: { type: "string" as const, description: "Task description" },
            limit: { type: "number" as const, description: "Max results" },
            includeSymbols: { type: "boolean" as const, description: "Also search functions/classes" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["task"],
        },
      },
      {
        name: "muninn_enrich",
        description: "Auto-inject context for a tool call.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tool: { type: "string" as const, enum: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"], description: "Tool being called" },
            input: { type: "string" as const, description: "Tool input (JSON string)" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["tool", "input"],
        },
      },
      {
        name: "muninn_approve",
        description: "Approve a blocked operation for high-fragility files.",
        inputSchema: {
          type: "object" as const,
          properties: {
            operationId: { type: "string" as const, description: "Operation ID from blocked message" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["operationId"],
        },
      },
      {
        name: "muninn",
        description: "Run any muninn CLI command (status, fragile, insights, etc.)",
        inputSchema: {
          type: "object" as const,
          properties: {
            command: { type: "string" as const, description: "CLI command (without 'muninn' prefix)" },
            cwd: { type: "string" as const, description: "Working directory" },
          },
          required: ["command"],
        },
      },
    ],
  }));

  // Tool handler - routes to same handlers as local MCP server
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const typedArgs = args as Record<string, unknown>;
    const cwd = (typedArgs.cwd as string) || "/remote";

    try {
      const projectId = await getProjectId(db, cwd);

      // Track usage (fire and forget)
      incrementToolCallCount(tenantId).catch(() => {});

      let result: string;

      switch (name) {
        case "muninn_query": {
          const v = validateInput(QueryInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handleQuery(db, projectId, v.data);
          break;
        }
        case "muninn_check": {
          const v = validateInput(CheckInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handleCheck(db, projectId, v.data.cwd || cwd, v.data);
          break;
        }
        case "muninn_file_add": {
          const v = validateInput(FileAddInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handleFileAdd(db, projectId, v.data);
          break;
        }
        case "muninn_decision_add": {
          const v = validateInput(DecisionAddInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handleDecisionAdd(db, projectId, v.data);
          break;
        }
        case "muninn_learn_add": {
          const v = validateInput(LearnAddInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handleLearnAdd(db, projectId, v.data);
          break;
        }
        case "muninn_issue": {
          const v = validateInput(IssueInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          if (v.data.action === "add") {
            result = await handleIssueAdd(db, projectId, v.data);
          } else {
            result = await handleIssueResolve(db, v.data);
          }
          break;
        }
        case "muninn_session": {
          const v = validateInput(SessionInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          const workingCwd = v.data.cwd || cwd;
          if (v.data.action === "start") {
            result = await handleSessionStart(db, projectId, v.data, workingCwd);
          } else {
            result = await handleSessionEnd(db, projectId, v.data);
          }
          break;
        }
        case "muninn_predict": {
          const v = validateInput(PredictInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handlePredict(db, projectId, v.data);
          break;
        }
        case "muninn_suggest": {
          const v = validateInput(SuggestInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handleSuggest(db, projectId, v.data);
          break;
        }
        case "muninn_enrich": {
          const v = validateInput(EnrichInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handleEnrich(db, projectId, v.data.cwd || cwd, v.data);
          break;
        }
        case "muninn_approve": {
          const v = validateInput(ApproveInput, typedArgs);
          if (!v.success) throw new Error(v.error);
          result = await handleApprove(db, v.data);
          break;
        }
        case "muninn": {
          const v = validateInput(PassthroughInput, typedArgs);
          if (!v.success) throw new Error(v.error);

          const parsedArgs = parseCommandArgs(v.data.command);
          if (parsedArgs.length === 0) throw new Error("Empty command");

          const subcommand = parsedArgs[0].toLowerCase();
          if (!ALLOWED_PASSTHROUGH_COMMANDS.has(subcommand)) {
            throw new Error(
              `Command "${subcommand}" not available in cloud mode. ` +
              `Filesystem-dependent commands (git-info, sync-hashes, drift, deps, blast, db) require local installation.`
            );
          }

          for (let i = 1; i < parsedArgs.length; i++) {
            const argResult = SafePassthroughArg.safeParse(parsedArgs[i]);
            if (!argResult.success) {
              throw new Error(`Invalid argument at position ${i}: ${argResult.error.errors[0]?.message || "validation failed"}`);
            }
          }

          result = await handlePassthrough(db, projectId, v.data.cwd || cwd, subcommand, parsedArgs.slice(1));
          break;
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Get the number of active MCP sessions.
 */
export function getSessionCount(): number {
  return sessions.size;
}

/**
 * Close all active MCP sessions (for graceful shutdown).
 */
export async function closeAllSessions(): Promise<void> {
  for (const [id, session] of sessions) {
    try {
      session.transport.close();
    } catch {
      // Best effort
    }
    sessions.delete(id);
  }
}

// ============================================================================
// Request Handler (called from Hono route)
// ============================================================================

/**
 * Handle an MCP request for an authenticated tenant.
 */
export async function handleMcpRequest(req: Request, authInfo: AuthInfo): Promise<Response> {
  const tenantId = authInfo.clientId;
  const sessionId = req.headers.get("mcp-session-id");

  // Try to resume existing session
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session && session.tenantId === tenantId) {
      return session.transport.handleRequest(req, { authInfo });
    }
    // Session not found or tenant mismatch - for non-init requests this is an error
    // but the transport will handle it correctly
  }

  // Create new session
  const db = await getTenantDb(tenantId);
  const server = createServer(tenantId, db);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (newSessionId) => {
      sessions.set(newSessionId, {
        server,
        transport,
        tenantId,
        createdAt: Date.now(),
      });
    },
    onsessionclosed: (closedSessionId) => {
      sessions.delete(closedSessionId);
    },
  });

  await server.connect(transport);
  return transport.handleRequest(req, { authInfo });
}
