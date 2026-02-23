/**
 * Muninn MCP Server — Resource Handlers
 *
 * MCP resource endpoints:
 *   muninn://context/current  — Task-relevant context from recent tool calls
 *   muninn://context/errors   — Recent errors with known fixes
 *   muninn://warnings/active  — Active warnings: fragile files, critical issues, contradictions
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { DatabaseAdapter } from "./database/adapter.js";
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
        {
          uri: "muninn://warnings/active",
          name: "Active Warnings",
          description: "Active warnings: high-fragility files, critical issues, contradictions. Poll periodically for proactive risk alerts.",
          mimeType: "text/plain",
        },
        {
          uri: "muninn://context/shared",
          name: "Shared Agent Context",
          description: "Cross-agent shared context: risk alerts, team learnings, and collaboration state for multi-agent workflows.",
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

      if (uri === "muninn://warnings/active") {
        return await readActiveWarnings(db, projectId, uri);
      }

      if (uri === "muninn://context/shared") {
        return await readSharedContext(db, projectId, uri);
      }

      return { contents: [{ uri, mimeType: "text/plain", text: `Unknown resource: ${uri}` }] };
    } catch (error) {
      return {
        contents: [{ uri, mimeType: "text/plain", text: `Error reading resource: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  });
}

// ============================================================================
// Active Warnings Resource
// ============================================================================

type ResourceResponse = {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
};

/** Read high-fragility files, critical issues, contradictions, and failed decisions */
async function readActiveWarnings(
  db: DatabaseAdapter,
  projectId: number,
  uri: string,
): Promise<ResourceResponse> {
  const sections: string[] = [];

  await collectFragileFiles(db, projectId, sections);
  await collectCriticalIssues(db, projectId, sections);
  await collectContradictions(db, projectId, sections);
  await collectFailedDecisions(db, projectId, sections);

  if (sections.length === 0) {
    return { contents: [{ uri, mimeType: "text/plain", text: "No active warnings." }] };
  }

  return { contents: [{ uri, mimeType: "text/plain", text: sections.join("\n") }] };
}

/** Collect files with fragility >= 7 */
async function collectFragileFiles(
  db: DatabaseAdapter,
  projectId: number,
  sections: string[],
): Promise<void> {
  try {
    const fragileFiles = await db.all<{
      path: string;
      fragility: number;
      fragility_signals: string | null;
    }>(
      `SELECT path, fragility, fragility_signals FROM files
       WHERE project_id = ? AND fragility >= 7 AND archived_at IS NULL
       ORDER BY fragility DESC LIMIT 10`,
      [projectId],
    );
    if (fragileFiles.length > 0) {
      sections.push("HIGH-FRAGILITY FILES:");
      for (const f of fragileFiles) {
        const signals = f.fragility_signals ? ` (${f.fragility_signals})` : "";
        sections.push(`  [${f.fragility}] ${f.path}${signals}`);
      }
    }
  } catch {
    // fragility_signals column may not exist in older schemas
  }
}

/** Collect open issues with severity >= 8 */
async function collectCriticalIssues(
  db: DatabaseAdapter,
  projectId: number,
  sections: string[],
): Promise<void> {
  try {
    const criticalIssues = await db.all<{
      title: string;
      severity: number;
      type: string | null;
    }>(
      `SELECT title, severity, type FROM issues
       WHERE project_id = ? AND status = 'open' AND severity >= 8
       ORDER BY severity DESC LIMIT 5`,
      [projectId],
    );
    if (criticalIssues.length > 0) {
      sections.push("");
      sections.push("CRITICAL ISSUES:");
      for (const i of criticalIssues) {
        const typeStr = i.type ? ` [${i.type}]` : "";
        sections.push(`  [sev:${i.severity}]${typeStr} ${i.title}`);
      }
    }
  } catch {
    // issues table may not exist in older schemas
  }
}

/** Collect active (non-dismissed) contradiction alerts */
async function collectContradictions(
  db: DatabaseAdapter,
  projectId: number,
  sections: string[],
): Promise<void> {
  try {
    const contradictions = await db.all<{
      contradiction_summary: string;
      severity: string;
      source_type: string;
    }>(
      `SELECT contradiction_summary, severity, source_type FROM contradiction_alerts
       WHERE project_id = ? AND dismissed = 0
       ORDER BY created_at DESC LIMIT 5`,
      [projectId],
    );
    if (contradictions.length > 0) {
      sections.push("");
      sections.push("CONTRADICTIONS:");
      for (const c of contradictions) {
        sections.push(`  [${c.severity}] ${c.source_type}: ${c.contradiction_summary.slice(0, 80)}`);
      }
    }
  } catch {
    // contradiction_alerts table may not exist in older schemas
  }
}

// ============================================================================
// Shared Agent Context Resource
// ============================================================================

/** Read shared context for multi-agent collaboration */
async function readSharedContext(
  db: DatabaseAdapter,
  projectId: number,
  uri: string,
): Promise<ResourceResponse> {
  const sections: string[] = [];

  // 1. Active risk alerts
  try {
    const alerts = await db.all<{
      alert_type: string;
      severity: string;
      title: string;
      details: string | null;
    }>(
      `SELECT alert_type, severity, title, details FROM risk_alerts
       WHERE project_id = ? AND dismissed = 0
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
       LIMIT 10`,
      [projectId],
    );

    if (alerts.length > 0) {
      sections.push("RISK ALERTS:");
      for (const a of alerts) {
        sections.push(`  [${a.severity}] ${a.title}`);
      }
    }
  } catch {
    // risk_alerts table may not exist
  }

  // 2. High-confidence team learnings
  try {
    const teamLearnings = await db.all<{
      title: string;
      content: string;
      confidence: number;
    }>(
      `SELECT title, content, confidence FROM team_learnings
       WHERE confidence >= 7
       ORDER BY confidence DESC LIMIT 10`,
      [],
    );

    if (teamLearnings.length > 0) {
      sections.push("");
      sections.push("TEAM KNOWLEDGE:");
      for (const l of teamLearnings) {
        sections.push(`  [conf:${l.confidence}] ${l.title}: ${l.content.slice(0, 60)}`);
      }
    }
  } catch {
    // team_learnings table may not exist
  }

  // 3. Current session state (what other agents might need)
  try {
    const session = await db.get<{
      goal: string | null;
      session_number: number | null;
    }>(
      `SELECT goal, session_number FROM sessions
       WHERE project_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [projectId],
    );

    if (session?.goal) {
      sections.push("");
      sections.push(`ACTIVE SESSION: #${session.session_number ?? '?'} — ${session.goal}`);
    }
  } catch {
    // sessions table may not exist
  }

  // 4. Recently modified fragile files (hot spots)
  try {
    const hotFiles = await db.all<{
      path: string;
      fragility: number;
      temperature: string | null;
    }>(
      `SELECT path, fragility, temperature FROM files
       WHERE project_id = ? AND fragility >= 5 AND temperature = 'hot' AND archived_at IS NULL
       ORDER BY fragility DESC LIMIT 5`,
      [projectId],
    );

    if (hotFiles.length > 0) {
      sections.push("");
      sections.push("HOT FRAGILE FILES (exercise caution):");
      for (const f of hotFiles) {
        sections.push(`  [${f.fragility}/10] ${f.path}`);
      }
    }
  } catch {
    // files table may lack expected columns
  }

  if (sections.length === 0) {
    return { contents: [{ uri, mimeType: "text/plain", text: "No shared context available." }] };
  }

  return { contents: [{ uri, mimeType: "text/plain", text: sections.join("\n") }] };
}

/** Collect recently failed or revised decisions */
async function collectFailedDecisions(
  db: DatabaseAdapter,
  projectId: number,
  sections: string[],
): Promise<void> {
  try {
    const failedDecisions = await db.all<{
      title: string;
      outcome: string;
    }>(
      `SELECT title, outcome FROM decisions
       WHERE project_id = ? AND outcome IN ('failed', 'revised') AND archived_at IS NULL
       ORDER BY updated_at DESC LIMIT 5`,
      [projectId],
    );
    if (failedDecisions.length > 0) {
      sections.push("");
      sections.push("FAILED/REVISED DECISIONS:");
      for (const d of failedDecisions) {
        sections.push(`  [${d.outcome}] ${d.title}`);
      }
    }
  } catch {
    // decisions table may not exist in older schemas
  }
}
