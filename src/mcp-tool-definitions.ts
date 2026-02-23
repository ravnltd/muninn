/**
 * Muninn MCP Server — Tool Definitions
 *
 * Pure data: the array of all 12 tool schemas returned by ListToolsRequestSchema.
 * No runtime imports needed — this is a static definition.
 */

export const TOOL_DEFINITIONS = [
  // ========== CORE TOOLS (full schemas) ==========

  {
    name: "muninn_query",
    description: "Search project memory (decisions, issues, learnings, files). Use before changes.",
    inputSchema: {
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
      properties: {
        task: { type: "string", description: "Task description" },
        files: { type: "array", items: { type: "string" }, description: "Files involved" },
        advise: {
          type: "boolean",
          description: "Generate planning advisory with risk assessment and recommendations",
        },
        cwd: { type: "string", description: "Working directory" },
      },
      required: [] as string[],
    },
  },

  {
    name: "muninn_suggest",
    description:
      "Suggest files for a task using semantic search. Finds conceptually related files (e.g., 'fix auth bug' finds login, session, token files).",
    inputSchema: {
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
      properties: {
        command: { type: "string", description: "CLI command (without 'muninn' prefix)" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["command"],
    },
  },
];
