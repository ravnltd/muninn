/**
 * Muninn MCP Server — Tool Definitions
 *
 * 4 tools: recall, remember, track, muninn
 * ~1,300 fewer tokens than the previous 17-tool surface.
 */

export const TOOL_DEFINITIONS = [
  {
    name: "recall",
    description: "Your memory. One tool for all context. Give it files (pre-edit warnings), a query (search memory), or a task (planning context). Returns fragility, co-changers, decisions, learnings, issues, blast radius — everything you need in one call.",
    inputSchema: {
      type: "object" as const,
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Files you are about to edit — returns fragility, co-changers, decisions, issues, blast radius" },
        query: { type: "string", description: "Search memory — returns matching decisions, learnings, issues, files" },
        task: { type: "string", description: "Task you are planning — returns related files, decisions, learnings, issues" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: [] as string[],
    },
  },

  {
    name: "remember",
    description: "Record a decision or learning. Natural language — auto-categorizes as decision or learning based on content. Use for novel insights only; routine file knowledge is captured automatically.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "What you want to remember. Natural language." },
        type: { type: "string", enum: ["decision", "learning"], description: "Override auto-detection if needed" },
        files: { type: "array", items: { type: "string" }, description: "Related file paths" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["content"],
    },
  },

  {
    name: "track",
    description: "Track issues. Actions: add (record bug/debt), resolve (mark fixed).",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["add", "resolve"], description: "add or resolve" },
        title: { type: "string", description: "Issue title (for add)" },
        description: { type: "string", description: "Details (for add)" },
        severity: { type: "number", description: "1-10 (for add, default 5)" },
        type: { type: "string", enum: ["bug", "debt", "security", "performance"], description: "Issue type (for add)" },
        files: { type: "array", items: { type: "string" }, description: "Affected files (for add)" },
        id: { type: "number", description: "Issue ID (for resolve)" },
        resolution: { type: "string", description: "How resolved (for resolve)" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["action"],
    },
  },

  {
    name: "muninn",
    description: `Run a muninn CLI command. Available: status, reindex, db, fragile, outcome.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "CLI command (without 'muninn' prefix)" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["command"],
    },
  },
];
