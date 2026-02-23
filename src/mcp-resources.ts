/**
 * Muninn MCP Server — Resource Handlers
 *
 * MCP resource endpoints: muninn://context/current and muninn://context/errors.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getTaskContext } from "./context/task-analyzer.js";
import { getDb, getProjectId, buildCalibratedContext } from "./mcp-state.js";

/** Register ListResources and ReadResource handlers on the MCP server */
export function registerResourceHandlers(server: Server): void {
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
}
