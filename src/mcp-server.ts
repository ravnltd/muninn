#!/usr/bin/env bun

/**
 * Muninn — MCP Server (Optimized + Hardened)
 *
 * Hybrid tool approach:
 * - 9 core tools with full schemas (frequently used, benefit from validation)
 * - 1 passthrough tool for whitelisted commands (saves ~8k tokens)
 *
 * Security:
 * - Uses Bun.spawnSync with argument arrays (no shell interpolation)
 * - Command whitelist for passthrough tool
 * - Input validation via Zod schemas
 */

import { existsSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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

function log(msg: string): void {
  process.stderr.write(`[muninn-mcp] ${msg}\n`);
}

/**
 * Find muninn CLI binary. Checks:
 * 1. Bun.which() - PATH lookup
 * 2. Same directory as this executable (compiled installation)
 * 3. Common installation locations
 */
function resolveMuninnBin(): string {
  // Try PATH first (works when PATH includes ~/.local/bin)
  const fromPath = Bun.which("muninn");
  if (fromPath) return fromPath;

  // Check sibling (when both compiled to same dir)
  const execPath = process.execPath;
  if (execPath && !execPath.includes("bun")) {
    // Running as compiled binary
    const execDir = execPath.replace(/\/[^/]+$/, "");
    const sibling = `${execDir}/muninn`;
    if (existsSync(sibling)) return sibling;
  }

  // Common locations
  const home = process.env.HOME || "";
  const locations = [
    `${home}/.local/bin/muninn`,
    "/usr/local/bin/muninn",
  ];
  for (const loc of locations) {
    if (existsSync(loc)) return loc;
  }

  // Fallback - let spawn fail with clear error
  log("Warning: Could not find muninn binary, falling back to PATH");
  return "muninn";
}

const MUNINN_BIN = resolveMuninnBin();

/**
 * Execute muninn CLI with safe argument array (no shell interpolation).
 * Uses Bun.spawnSync to avoid shell injection vulnerabilities.
 */
function runContext(args: string[], cwd?: string): string {
  try {
    const result = Bun.spawnSync([MUNINN_BIN, ...args], {
      cwd: cwd || process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    if (result.exitCode !== 0) {
      return stderr || stdout || `Command failed with exit code ${result.exitCode}`;
    }

    return stdout || stderr;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
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

const server = new Server({ name: "muninn", version: "2.0.0" }, { capabilities: { tools: {} } });

// ============================================================================
// Tool Definitions - 8 Core + 1 Passthrough
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
// Tool Handlers
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = args as Record<string, unknown>;
  const cwd = (typedArgs.cwd as string) || process.cwd();

  log(`Tool: ${name} args: ${JSON.stringify(args)}`);

  try {
    let result: string;

    switch (name) {
      // ========== CORE TOOLS ==========

      case "muninn_query": {
        const validation = validateInput(QueryInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { query, smart, vector, fts } = validation.data;
        const args = ["query", query];
        if (smart) args.push("--smart");
        if (vector) args.push("--vector");
        if (fts) args.push("--fts");
        result = runContext(args, validation.data.cwd || cwd);
        break;
      }

      case "muninn_check": {
        const validation = validateInput(CheckInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { files } = validation.data;
        result = runContext(["check", ...files], validation.data.cwd || cwd);
        break;
      }

      case "muninn_file_add": {
        const validation = validateInput(FileAddInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { path, purpose, fragility, fragility_reason, type } = validation.data;
        const args = ["file", "add", path, "--purpose", purpose, "--fragility", String(fragility)];
        if (fragility_reason) args.push("--fragility-reason", fragility_reason);
        if (type) args.push("--type", type);
        result = runContext(args, validation.data.cwd || cwd);
        break;
      }

      case "muninn_decision_add": {
        const validation = validateInput(DecisionAddInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { title, decision, reasoning, affects } = validation.data;
        const args = ["decision", "add", "--title", title, "--decision", decision, "--reasoning", reasoning];
        if (affects) args.push("--affects", affects);
        result = runContext(args, validation.data.cwd || cwd);
        break;
      }

      case "muninn_learn_add": {
        const validation = validateInput(LearnAddInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { title, content, category, context, global: isGlobal, files, foundational, reviewAfter } =
          validation.data;
        const args = ["learn", "add", "--title", title, "--content", content];
        if (category) args.push("--category", category);
        if (context) args.push("--context", context);
        if (isGlobal) args.push("--global");
        if (files) args.push("--files", files);
        if (foundational) args.push("--foundational");
        if (reviewAfter) args.push("--review-after", String(reviewAfter));
        result = runContext(args, validation.data.cwd || cwd);
        break;
      }

      case "muninn_issue": {
        const validation = validateInput(IssueInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const data = validation.data;
        if (data.action === "add") {
          const args = ["issue", "add", "--title", data.title, "--severity", String(data.severity ?? 5)];
          if (data.description) args.push("--description", data.description);
          if (data.type) args.push("--type", data.type);
          result = runContext(args, data.cwd || cwd);
        } else {
          result = runContext(["issue", "resolve", String(data.id), data.resolution], data.cwd || cwd);
        }
        break;
      }

      case "muninn_session": {
        const validation = validateInput(SessionInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const data = validation.data;
        const workingCwd = data.cwd || cwd;
        if (data.action === "start") {
          // Auto-end any active session
          const prevSession = runContext(["session", "last", "--json"], workingCwd);
          try {
            const prev = JSON.parse(prevSession);
            if (prev && !prev.ended_at) {
              runContext(["session", "end", String(prev.id), "--outcome", "Replaced by new session"], workingCwd);
            }
          } catch {
            /* no previous session */
          }
          result = runContext(["session", "start", data.goal], workingCwd);
        } else {
          const lastSession = runContext(["session", "last", "--json"], workingCwd);
          let sessionId: number | null = null;
          try {
            const parsed = JSON.parse(lastSession);
            if (parsed && !parsed.ended_at) sessionId = parsed.id;
          } catch {
            /* no active session */
          }

          if (!sessionId) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "No active session" }) }] };
          }

          const args = ["session", "end", String(sessionId)];
          if (data.outcome) args.push("--outcome", data.outcome);
          if (data.next_steps) args.push("--next", data.next_steps);
          if (data.success !== undefined) args.push("--success", String(data.success));
          result = runContext(args, workingCwd);
        }
        break;
      }

      case "muninn_predict": {
        const validation = validateInput(PredictInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { task, files, advise } = validation.data;
        const args = ["predict"];
        if (task) args.push(task);
        if (files && files.length > 0) args.push("--files", ...files);
        if (advise) args.push("--advise");
        result = runContext(args, validation.data.cwd || cwd);
        break;
      }

      case "muninn_suggest": {
        const validation = validateInput(SuggestInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { task, limit, includeSymbols } = validation.data;
        const args = ["suggest", task];
        if (limit) args.push("--limit", String(limit));
        if (includeSymbols) args.push("--symbols");
        result = runContext(args, validation.data.cwd || cwd);
        break;
      }

      case "muninn_enrich": {
        const validation = validateInput(EnrichInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { tool, input } = validation.data;
        result = runContext(["enrich", tool, input], validation.data.cwd || cwd);
        break;
      }

      case "muninn_approve": {
        const validation = validateInput(ApproveInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { operationId } = validation.data;
        result = runContext(["approve", operationId], validation.data.cwd || cwd);
        break;
      }

      // ========== PASSTHROUGH ==========

      case "muninn": {
        const validation = validateInput(PassthroughInput, typedArgs);
        if (!validation.success) throw new Error(validation.error);
        const { command } = validation.data;

        const args = parseCommandArgs(command);
        if (args.length === 0) throw new Error("Empty command");

        const subcommand = args[0].toLowerCase();
        if (!ALLOWED_PASSTHROUGH_COMMANDS.has(subcommand)) {
          throw new Error(
            `Command "${subcommand}" not allowed via passthrough. Use dedicated tools for: query, check, file, decision, learn, issue, session, predict, suggest, enrich, approve. Allowed passthrough commands: ${[...ALLOWED_PASSTHROUGH_COMMANDS].sort().join(", ")}`
          );
        }

        // Validate each argument for shell metacharacters (H1: Passthrough arg validation)
        for (let i = 1; i < args.length; i++) {
          const argResult = SafePassthroughArg.safeParse(args[i]);
          if (!argResult.success) {
            throw new Error(
              `Invalid argument at position ${i}: ${argResult.error.errors[0]?.message || "validation failed"}`
            );
          }
        }

        result = runContext(args, validation.data.cwd || cwd);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    log(`Error: ${error}`);
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

// ============================================================================
// Start Server
// ============================================================================

async function main(): Promise<void> {
  log("Starting Muninn MCP Server v2 (optimized)...");
  log(`Using muninn binary: ${MUNINN_BIN}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server connected via stdio");
}

main().catch((error) => {
  log(`Fatal error: ${error}`);
  process.exit(1);
});
