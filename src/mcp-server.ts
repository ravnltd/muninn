#!/usr/bin/env bun
/**
 * Claude Context Engine — MCP Server
 * Exposes context commands as native Claude Code tools
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";

// Log to stderr only (stdout is for JSON-RPC)
function log(msg: string): void {
  process.stderr.write(`[context-mcp] ${msg}\n`);
}

// Execute context CLI command
function runContext(args: string, cwd?: string): string {
  try {
    const result = execSync(`context ${args}`, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 30000,
    });
    return result;
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      return (error as { stderr: string }).stderr || error.message;
    }
    return String(error);
  }
}

const server = new Server(
  {
    name: "claude-context",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "context_status",
        description:
          "Get current project state including fragile files, open issues, and recent decisions. ALWAYS call this at the start of a session to understand the project.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional, defaults to current)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_fragile",
        description:
          "List files with high fragility scores that need careful handling. Call this BEFORE modifying any files to check if they're dangerous.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_query",
        description:
          "Search project memory for relevant context. Supports hybrid search (FTS + vector similarity) when embeddings are available. Use this to find decisions, issues, learnings, and file knowledge about a topic BEFORE making changes.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query (e.g., 'authentication', 'database issues')",
            },
            smart: {
              type: "boolean",
              description: "Use Claude API for intelligent re-ranking (optional)",
            },
            vector: {
              type: "boolean",
              description: "Use vector similarity search only (requires VOYAGE_API_KEY)",
            },
            fts: {
              type: "boolean",
              description: "Use full-text search only (ignores embeddings)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "context_file_add",
        description:
          "Record knowledge about a file including its purpose and fragility. Call this AFTER modifying a file to update the project memory.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path relative to project root",
            },
            purpose: {
              type: "string",
              description: "What this file does and why it exists",
            },
            fragility: {
              type: "number",
              description: "Fragility score 1-10 (10 = most dangerous to change)",
            },
            fragility_reason: {
              type: "string",
              description: "Why this file is fragile (optional)",
            },
            type: {
              type: "string",
              description: "File type: component, util, config, route, model, test, etc.",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["path", "purpose", "fragility"],
        },
      },
      {
        name: "context_decision_add",
        description:
          "Record an architectural or design decision. Use this when you make a significant choice that future sessions should know about.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title for the decision",
            },
            decision: {
              type: "string",
              description: "What was decided",
            },
            reasoning: {
              type: "string",
              description: "Why this decision was made",
            },
            affects: {
              type: "string",
              description: "JSON array of affected file paths (optional)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["title", "decision", "reasoning"],
        },
      },
      {
        name: "context_issue_add",
        description:
          "Record a known issue or bug. Use this when you discover a problem that needs tracking.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title for the issue",
            },
            description: {
              type: "string",
              description: "Detailed description of the issue",
            },
            severity: {
              type: "number",
              description: "Severity 1-10 (10 = most severe)",
            },
            type: {
              type: "string",
              description: "Issue type: bug, potential, security, performance",
            },
            workaround: {
              type: "string",
              description: "Known workaround (optional)",
            },
            files: {
              type: "string",
              description: "JSON array of affected file paths (optional)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["title", "severity"],
        },
      },
      {
        name: "context_issue_resolve",
        description:
          "Mark an issue as resolved. Use this when you fix a known issue.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Issue ID to resolve",
            },
            resolution: {
              type: "string",
              description: "How the issue was resolved",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["id", "resolution"],
        },
      },
      {
        name: "context_learn_add",
        description:
          "Record a learning, pattern, or gotcha. Use this when you discover something that future sessions should know.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title for the learning",
            },
            content: {
              type: "string",
              description: "The learning content",
            },
            category: {
              type: "string",
              description: "Category: pattern, gotcha, preference, convention",
            },
            context: {
              type: "string",
              description: "When this applies (optional)",
            },
            global: {
              type: "boolean",
              description: "Apply to all projects, not just this one",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["title", "content"],
        },
      },
      {
        name: "context_ship",
        description:
          "Run pre-deploy checklist. Use this before deploying to verify the project is ready.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_debt_add",
        description:
          "Record technical debt. Use this when you take a shortcut that should be fixed later.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title for the debt item",
            },
            description: {
              type: "string",
              description: "Description of the technical debt",
            },
            severity: {
              type: "number",
              description: "Severity 1-10",
            },
            effort: {
              type: "string",
              description: "Effort to fix: small, medium, large",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["title", "severity", "effort"],
        },
      },
      {
        name: "context_debt_list",
        description: "List all technical debt items.",
        inputSchema: {
          type: "object",
          properties: {
            project_only: {
              type: "boolean",
              description: "Show only project-specific debt",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_embed",
        description:
          "Manage vector embeddings for semantic search. Use 'status' to check coverage, 'backfill' to generate missing embeddings, 'test' to verify embedding generation.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["status", "backfill", "test"],
              description: "Action to perform: status (show coverage), backfill (generate missing), test (test embedding)",
            },
            table: {
              type: "string",
              enum: ["files", "decisions", "issues", "learnings", "all"],
              description: "Table to backfill (optional, defaults to all)",
            },
            text: {
              type: "string",
              description: "Text to test embedding generation (required for test action)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["action"],
        },
      },
      {
        name: "context_vector_search",
        description:
          "Pure semantic similarity search using vector embeddings. Returns results ranked by similarity to the query. Requires VOYAGE_API_KEY to be set.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query text",
            },
            tables: {
              type: "array",
              items: { type: "string" },
              description: "Tables to search: files, decisions, issues, learnings (optional, defaults to all)",
            },
            limit: {
              type: "number",
              description: "Maximum results to return (optional, default 10)",
            },
            threshold: {
              type: "number",
              description: "Minimum similarity threshold 0-1 (optional, default 0.3)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "context_check",
        description:
          "Pre-edit warnings for files. Call this BEFORE modifying files to check fragility, related issues, staleness, and get suggestions. Essential for safe editing.",
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "File paths to check (relative to project root)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["files"],
        },
      },
      {
        name: "context_impact",
        description:
          "Analyze what depends on a file. Shows direct dependents, indirect dependents, related decisions, and suggested tests. Use before making changes to understand the blast radius.",
        inputSchema: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "File path to analyze (relative to project root)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["file"],
        },
      },
      {
        name: "context_drift",
        description:
          "Detect knowledge drift. Shows files that have changed since last analysis, git changes, and untracked files. Use at session start to see what's out of date.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_smart_status",
        description:
          "Get actionable project status with prioritized recommendations. Shows project health, warnings, and suggested next actions. More useful than basic status.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_resume",
        description:
          "Get session resume information. Shows last session goal, outcome, files modified, and pending next steps. Use at session start to continue where you left off.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_session_start",
        description:
          "Start a new work session with a goal. Call this after context_resume when you understand what the user wants to accomplish. The session tracks files modified, queries made, and learnings.",
        inputSchema: {
          type: "object",
          properties: {
            goal: {
              type: "string",
              description: "The goal for this session (e.g., 'Add user authentication', 'Fix payment bug')",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["goal"],
        },
      },
      {
        name: "context_session_end",
        description:
          "End the current work session with an outcome summary. Call this when the task is complete or the user is done working. Captures what was accomplished for future sessions.",
        inputSchema: {
          type: "object",
          properties: {
            outcome: {
              type: "string",
              description: "What was accomplished (e.g., 'Added JWT auth with refresh tokens')",
            },
            next_steps: {
              type: "string",
              description: "What should be done next (optional)",
            },
            success: {
              type: "number",
              description: "Success level: 0=failed, 1=partial, 2=success (default: 2)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_deps",
        description:
          "Query file dependencies. Shows what a file imports and what depends on it. Useful for understanding code relationships before refactoring.",
        inputSchema: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "File path to analyze (relative to project root)",
            },
            refresh: {
              type: "boolean",
              description: "Rebuild the full dependency graph (slow but thorough)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_conflicts",
        description:
          "Check if files have changed since last query. Use before editing to detect if someone else modified the files.",
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "File paths to check (relative to project root)",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["files"],
        },
      },
      {
        name: "context_bookmark_add",
        description:
          "Save context to working memory. Use this to 'set aside' important information (code patterns, decisions, snippets) that you can recall later without keeping it in your context window.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Short label for the bookmark (e.g., 'auth pattern', 'db schema')",
            },
            content: {
              type: "string",
              description: "The content to bookmark",
            },
            source: {
              type: "string",
              description: "Source reference (e.g., 'file:src/auth.ts:10-50')",
            },
            content_type: {
              type: "string",
              enum: ["text", "code", "json", "markdown"],
              description: "Type of content (default: text)",
            },
            priority: {
              type: "number",
              description: "Priority 1-5 (1 = highest, default: 3)",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for filtering",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["label", "content"],
        },
      },
      {
        name: "context_bookmark_get",
        description:
          "Retrieve a bookmarked piece of context by label. Use this to recall information you previously set aside.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Label of the bookmark to retrieve",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["label"],
        },
      },
      {
        name: "context_bookmark_list",
        description:
          "List all bookmarks in working memory. Shows what context you have saved for quick recall.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_bookmark_delete",
        description: "Delete a bookmark from working memory.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Label of the bookmark to delete",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["label"],
        },
      },
      {
        name: "context_bookmark_clear",
        description: "Clear all bookmarks from working memory.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_focus_set",
        description:
          "Set your current work focus area. Queries will automatically prioritize results from this area. Use when starting work on a specific feature or module.",
        inputSchema: {
          type: "object",
          properties: {
            area: {
              type: "string",
              description: "Focus area (e.g., 'authentication', 'api/v2', 'database layer')",
            },
            description: {
              type: "string",
              description: "What you're working on (optional)",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "File patterns to prioritize (e.g., ['src/auth/*', 'src/middleware/*'])",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "Keywords to boost in search (e.g., ['auth', 'session', 'token'])",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: ["area"],
        },
      },
      {
        name: "context_focus_get",
        description:
          "Get your current work focus. Shows what area you're focused on and any file/keyword boosts.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "context_focus_clear",
        description: "Clear your current work focus.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
          },
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = args as Record<string, unknown>;
  const cwd = (typedArgs.cwd as string) || process.cwd();

  log(`Tool called: ${name} with args: ${JSON.stringify(args)}`);

  try {
    let result: string;

    switch (name) {
      case "context_status":
        result = runContext("status", cwd);
        break;

      case "context_fragile":
        result = runContext("fragile", cwd);
        break;

      case "context_query": {
        const query = typedArgs.query as string;
        const smart = typedArgs.smart ? "--smart" : "";
        const vector = typedArgs.vector ? "--vector" : "";
        const fts = typedArgs.fts ? "--fts" : "";
        result = runContext(`query "${query}" ${smart} ${vector} ${fts}`.trim(), cwd);
        break;
      }

      case "context_file_add": {
        const path = typedArgs.path as string;
        const purpose = typedArgs.purpose as string;
        const fragility = typedArgs.fragility as number;
        const fragReason = typedArgs.fragility_reason
          ? `--fragility-reason "${typedArgs.fragility_reason}"`
          : "";
        const fileType = typedArgs.type ? `--type ${typedArgs.type}` : "";

        result = runContext(
          `file add "${path}" --purpose "${purpose}" --fragility ${fragility} ${fragReason} ${fileType}`.trim(),
          cwd
        );
        break;
      }

      case "context_decision_add": {
        const title = typedArgs.title as string;
        const decision = typedArgs.decision as string;
        const reasoning = typedArgs.reasoning as string;
        const affects = typedArgs.affects ? `--affects '${typedArgs.affects}'` : "";

        result = runContext(
          `decision add --title "${title}" --decision "${decision}" --reasoning "${reasoning}" ${affects}`.trim(),
          cwd
        );
        break;
      }

      case "context_issue_add": {
        const title = typedArgs.title as string;
        const severity = typedArgs.severity as number;
        const desc = typedArgs.description
          ? `--description "${typedArgs.description}"`
          : "";
        const type = typedArgs.type ? `--type ${typedArgs.type}` : "";
        const workaround = typedArgs.workaround
          ? `--workaround "${typedArgs.workaround}"`
          : "";
        const files = typedArgs.files ? `--files '${typedArgs.files}'` : "";

        result = runContext(
          `issue add --title "${title}" --severity ${severity} ${desc} ${type} ${workaround} ${files}`.trim(),
          cwd
        );
        break;
      }

      case "context_issue_resolve": {
        const id = typedArgs.id as number;
        const resolution = typedArgs.resolution as string;
        result = runContext(`issue resolve ${id} "${resolution}"`, cwd);
        break;
      }

      case "context_learn_add": {
        const title = typedArgs.title as string;
        const content = typedArgs.content as string;
        const category = typedArgs.category ? `--category ${typedArgs.category}` : "";
        const context = typedArgs.context ? `--context "${typedArgs.context}"` : "";
        const global = typedArgs.global ? "--global" : "";

        result = runContext(
          `learn add --title "${title}" --content "${content}" ${category} ${context} ${global}`.trim(),
          cwd
        );
        break;
      }

      case "context_ship":
        result = runContext("ship", cwd);
        break;

      case "context_debt_add": {
        const title = typedArgs.title as string;
        const severity = typedArgs.severity as number;
        const effort = typedArgs.effort as string;
        const desc = typedArgs.description
          ? `--description "${typedArgs.description}"`
          : "";

        result = runContext(
          `debt add --title "${title}" --severity ${severity} --effort ${effort} ${desc}`.trim(),
          cwd
        );
        break;
      }

      case "context_debt_list": {
        const projectOnly = typedArgs.project_only ? "--project" : "";
        result = runContext(`debt list ${projectOnly}`.trim(), cwd);
        break;
      }

      case "context_embed": {
        const action = typedArgs.action as string;
        const table = typedArgs.table as string | undefined;
        const text = typedArgs.text as string | undefined;

        if (action === "test" && text) {
          result = runContext(`embed test "${text}"`, cwd);
        } else if (action === "backfill" && table && table !== "all") {
          result = runContext(`embed backfill ${table}`, cwd);
        } else {
          result = runContext(`embed ${action}`, cwd);
        }
        break;
      }

      case "context_vector_search": {
        const query = typedArgs.query as string;
        // Use the --vector flag with the query command
        result = runContext(`query "${query}" --vector`, cwd);
        break;
      }

      case "context_check": {
        const files = typedArgs.files as string[];
        if (!files || files.length === 0) {
          throw new Error("Files array is required for context_check");
        }
        result = runContext(`check ${files.map(f => `"${f}"`).join(" ")}`, cwd);
        break;
      }

      case "context_impact": {
        const file = typedArgs.file as string;
        if (!file) {
          throw new Error("File path is required for context_impact");
        }
        result = runContext(`impact "${file}"`, cwd);
        break;
      }

      case "context_drift":
        result = runContext("drift", cwd);
        break;

      case "context_smart_status":
        result = runContext("ss", cwd);
        break;

      case "context_resume":
        result = runContext("resume", cwd);
        break;

      case "context_session_start": {
        const goal = typedArgs.goal as string;
        if (!goal) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Goal is required" }) }] };
        }
        // Auto-end any active session before starting a new one
        const prevSession = runContext("session last --json", cwd);
        try {
          const prev = JSON.parse(prevSession);
          if (prev && !prev.ended_at) {
            runContext(`session end ${prev.id} --outcome "Replaced by new session"`, cwd);
          }
        } catch { /* no previous session */ }
        result = runContext(`session start "${goal.replace(/"/g, '\\"')}"`, cwd);
        break;
      }

      case "context_session_end": {
        const outcome = typedArgs.outcome as string;
        const nextSteps = typedArgs.next_steps as string;
        const success = typedArgs.success as number;

        // Get active session ID first
        const lastSession = runContext("session last --json", cwd);
        let sessionId: number | null = null;
        try {
          const parsed = JSON.parse(lastSession);
          if (parsed && !parsed.ended_at) {
            sessionId = parsed.id;
          }
        } catch {
          // No active session
        }

        if (!sessionId) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "No active session to end" }) }] };
        }

        let cmd = `session end ${sessionId}`;
        if (outcome) cmd += ` --outcome "${outcome.replace(/"/g, '\\"')}"`;
        if (nextSteps) cmd += ` --next "${nextSteps.replace(/"/g, '\\"')}"`;
        if (success !== undefined) cmd += ` --success ${success}`;

        result = runContext(cmd, cwd);
        break;
      }

      case "context_deps": {
        const file = typedArgs.file as string;
        const refresh = typedArgs.refresh as boolean;

        if (refresh) {
          result = runContext("deps --refresh", cwd);
        } else if (file) {
          result = runContext(`deps "${file}"`, cwd);
        } else {
          result = runContext("deps --help", cwd);
        }
        break;
      }

      case "context_conflicts": {
        const files = typedArgs.files as string[];
        if (!files || files.length === 0) {
          throw new Error("Files array is required for context_conflicts");
        }
        result = runContext(`conflicts ${files.map(f => `"${f}"`).join(" ")}`, cwd);
        break;
      }

      case "context_bookmark_add": {
        const label = typedArgs.label as string;
        const content = typedArgs.content as string;
        const source = typedArgs.source ? `--source "${typedArgs.source}"` : "";
        const contentType = typedArgs.content_type ? `--type ${typedArgs.content_type}` : "";
        const priority = typedArgs.priority ? `--priority ${typedArgs.priority}` : "";
        const tags = typedArgs.tags ? `--tags '${JSON.stringify(typedArgs.tags)}'` : "";

        result = runContext(
          `bookmark add --label "${label}" --content "${content.replace(/"/g, '\\"')}" ${source} ${contentType} ${priority} ${tags}`.trim(),
          cwd
        );
        break;
      }

      case "context_bookmark_get": {
        const label = typedArgs.label as string;
        result = runContext(`bookmark get "${label}"`, cwd);
        break;
      }

      case "context_bookmark_list":
        result = runContext("bookmark list", cwd);
        break;

      case "context_bookmark_delete": {
        const label = typedArgs.label as string;
        result = runContext(`bookmark delete "${label}"`, cwd);
        break;
      }

      case "context_bookmark_clear":
        result = runContext("bookmark clear", cwd);
        break;

      case "context_focus_set": {
        const area = typedArgs.area as string;
        const desc = typedArgs.description ? `--description "${typedArgs.description}"` : "";
        const files = typedArgs.files ? `--files '${JSON.stringify(typedArgs.files)}'` : "";
        const keywords = typedArgs.keywords ? `--keywords '${JSON.stringify(typedArgs.keywords)}'` : "";

        result = runContext(
          `focus set --area "${area}" ${desc} ${files} ${keywords}`.trim(),
          cwd
        );
        break;
      }

      case "context_focus_get":
        result = runContext("focus get", cwd);
        break;

      case "context_focus_clear":
        result = runContext("focus clear", cwd);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (error) {
    log(`Error: ${error}`);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main(): Promise<void> {
  log("Starting Claude Context MCP Server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server connected via stdio");
}

main().catch((error) => {
  log(`Fatal error: ${error}`);
  process.exit(1);
});
