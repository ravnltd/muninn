#!/usr/bin/env bun
/**
 * Muninn — MCP Server (Optimized)
 *
 * Hybrid tool approach:
 * - 8 core tools with full schemas (frequently used, benefit from validation)
 * - 1 passthrough tool for all other commands (saves ~8k tokens)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";

function log(msg: string): void {
  process.stderr.write(`[muninn-mcp] ${msg}\n`);
}

function runContext(args: string, cwd?: string): string {
  try {
    const result = execSync(`muninn ${args}`, {
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
  { name: "muninn", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

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
        description: "Bundle all context for a task: files, co-changers, decisions, issues, learnings.",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string", description: "Task description" },
            files: { type: "array", items: { type: "string" }, description: "Files involved" },
            cwd: { type: "string", description: "Working directory" },
          },
          required: [],
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
        const query = typedArgs.query as string;
        const flags = [
          typedArgs.smart ? "--smart" : "",
          typedArgs.vector ? "--vector" : "",
          typedArgs.fts ? "--fts" : "",
        ].filter(Boolean).join(" ");
        result = runContext(`query "${query}" ${flags}`.trim(), cwd);
        break;
      }

      case "muninn_check": {
        const files = typedArgs.files as string[];
        if (!files || files.length === 0) {
          throw new Error("Files array required");
        }
        result = runContext(`check ${files.map(f => `"${f}"`).join(" ")}`, cwd);
        break;
      }

      case "muninn_file_add": {
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

      case "muninn_decision_add": {
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

      case "muninn_learn_add": {
        const title = typedArgs.title as string;
        const content = typedArgs.content as string;
        const category = typedArgs.category ? `--category ${typedArgs.category}` : "";
        const context = typedArgs.context ? `--context "${typedArgs.context}"` : "";
        const global = typedArgs.global ? "--global" : "";
        const files = typedArgs.files ? `--files '${typedArgs.files}'` : "";
        result = runContext(
          `learn add --title "${title}" --content "${content}" ${category} ${context} ${global} ${files}`.trim(),
          cwd
        );
        break;
      }

      case "muninn_issue": {
        const action = typedArgs.action as string;
        if (action === "add") {
          const title = typedArgs.title as string;
          const severity = typedArgs.severity as number || 5;
          const desc = typedArgs.description ? `--description "${typedArgs.description}"` : "";
          const issueType = typedArgs.type ? `--type ${typedArgs.type}` : "";
          result = runContext(
            `issue add --title "${title}" --severity ${severity} ${desc} ${issueType}`.trim(),
            cwd
          );
        } else if (action === "resolve") {
          const id = typedArgs.id as number;
          const resolution = typedArgs.resolution as string;
          result = runContext(`issue resolve ${id} "${resolution}"`, cwd);
        } else {
          throw new Error("Action must be 'add' or 'resolve'");
        }
        break;
      }

      case "muninn_session": {
        const action = typedArgs.action as string;
        if (action === "start") {
          const goal = typedArgs.goal as string;
          if (!goal) throw new Error("Goal required for session start");
          // Auto-end any active session
          const prevSession = runContext("session last --json", cwd);
          try {
            const prev = JSON.parse(prevSession);
            if (prev && !prev.ended_at) {
              runContext(`session end ${prev.id} --outcome "Replaced by new session"`, cwd);
            }
          } catch { /* no previous session */ }
          result = runContext(`session start "${goal.replace(/"/g, '\\"')}"`, cwd);
        } else if (action === "end") {
          const lastSession = runContext("session last --json", cwd);
          let sessionId: number | null = null;
          try {
            const parsed = JSON.parse(lastSession);
            if (parsed && !parsed.ended_at) sessionId = parsed.id;
          } catch { /* no active session */ }

          if (!sessionId) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "No active session" }) }] };
          }

          let cmd = `session end ${sessionId}`;
          if (typedArgs.outcome) cmd += ` --outcome "${(typedArgs.outcome as string).replace(/"/g, '\\"')}"`;
          if (typedArgs.next_steps) cmd += ` --next "${(typedArgs.next_steps as string).replace(/"/g, '\\"')}"`;
          if (typedArgs.success !== undefined) cmd += ` --success ${typedArgs.success}`;
          result = runContext(cmd, cwd);
        } else {
          throw new Error("Action must be 'start' or 'end'");
        }
        break;
      }

      case "muninn_predict": {
        const task = typedArgs.task as string | undefined;
        const files = typedArgs.files as string[] | undefined;
        let cmd = "predict";
        if (task) cmd += ` "${task.replace(/"/g, '\\"')}"`;
        if (files && files.length > 0) cmd += ` --files ${files.join(" ")}`;
        result = runContext(cmd, cwd);
        break;
      }

      // ========== PASSTHROUGH ==========

      case "muninn": {
        const command = typedArgs.command as string;
        if (!command) throw new Error("Command required");
        result = runContext(command, cwd);
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server connected via stdio");
}

main().catch((error) => {
  log(`Fatal error: ${error}`);
  process.exit(1);
});
