/**
 * Focus commands
 * Set the current work area to prioritize related results
 * Queries automatically prioritize results from the focus area
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess } from "../utils/format";
import { parseArgs } from "util";

// ============================================================================
// Types
// ============================================================================

interface Focus {
  id: number;
  project_id: number;
  session_id: number | null;
  area: string;
  description: string | null;
  files: string | null;
  keywords: string | null;
  created_at: string;
  cleared_at: string | null;
}

interface FocusSetOptions {
  area: string;
  description?: string;
  files?: string[];
  keywords?: string[];
}

// ============================================================================
// Set Focus
// ============================================================================

export function focusSet(
  db: Database,
  projectId: number,
  options: FocusSetOptions
): void {
  const { area, description, files, keywords } = options;

  if (!area) {
    console.error("Usage: muninn focus set --area <area>");
    console.error("Options:");
    console.error("  --description <text>   What you're working on");
    console.error("  --files <json>         JSON array of file patterns to prioritize");
    console.error("  --keywords <json>      JSON array of keywords to boost");
    process.exit(1);
  }

  // Clear any existing focus first
  db.run(`
    UPDATE focus SET cleared_at = CURRENT_TIMESTAMP
    WHERE project_id = ? AND cleared_at IS NULL
  `, [projectId]);

  // Set new focus
  db.run(`
    INSERT INTO focus (project_id, area, description, files, keywords)
    VALUES (?, ?, ?, ?, ?)
  `, [
    projectId,
    area,
    description || null,
    files ? JSON.stringify(files) : null,
    keywords ? JSON.stringify(keywords) : null,
  ]);

  console.error(`🎯 Focus set: ${area}`);
  if (description) {
    console.error(`   ${description}`);
  }
  if (files && files.length > 0) {
    console.error(`   Files: ${files.join(", ")}`);
  }
  if (keywords && keywords.length > 0) {
    console.error(`   Keywords: ${keywords.join(", ")}`);
  }

  outputSuccess({ area, set: true });
}

// ============================================================================
// Get Current Focus
// ============================================================================

export function focusGet(db: Database, projectId: number): Focus | null {
  const focus = db.query<Focus, [number]>(`
    SELECT * FROM focus
    WHERE project_id = ? AND cleared_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(projectId);

  if (!focus) {
    console.error("🎯 No active focus set");
    outputJson({ focus: null });
    return null;
  }

  console.error(`🎯 Current focus: ${focus.area}`);
  if (focus.description) {
    console.error(`   ${focus.description}`);
  }
  if (focus.files) {
    const files = JSON.parse(focus.files);
    console.error(`   Files: ${files.join(", ")}`);
  }
  if (focus.keywords) {
    const keywords = JSON.parse(focus.keywords);
    console.error(`   Keywords: ${keywords.join(", ")}`);
  }
  console.error(`   Set at: ${focus.created_at}`);

  outputJson(focus);
  return focus;
}

// ============================================================================
// Clear Focus
// ============================================================================

export function focusClear(db: Database, projectId: number): boolean {
  const result = db.run(`
    UPDATE focus SET cleared_at = CURRENT_TIMESTAMP
    WHERE project_id = ? AND cleared_at IS NULL
  `, [projectId]);

  if (result.changes === 0) {
    console.error("🎯 No active focus to clear");
    outputJson({ cleared: false });
    return false;
  }

  console.error("🎯 Focus cleared");
  outputSuccess({ cleared: true });
  return true;
}

// ============================================================================
// List Focus History
// ============================================================================

export function focusList(db: Database, projectId: number): Focus[] {
  const history = db.query<Focus, [number]>(`
    SELECT * FROM focus
    WHERE project_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(projectId);

  if (history.length === 0) {
    console.error("🎯 No focus history");
    outputJson([]);
    return [];
  }

  console.error(`🎯 Focus history (${history.length} entries):\n`);

  for (const f of history) {
    const status = f.cleared_at ? "cleared" : "active";
    const statusIcon = f.cleared_at ? "⭕" : "🎯";
    console.error(`${statusIcon} ${f.area} [${status}]`);
    if (f.description) {
      console.error(`   ${f.description}`);
    }
    console.error(`   ${f.created_at}`);
    console.error("");
  }

  outputJson(history);
  return history;
}

// ============================================================================
// Get Focus for Query Boosting
// ============================================================================

export function getActiveFocus(db: Database, projectId: number): {
  area: string;
  files: string[];
  keywords: string[];
} | null {
  const focus = db.query<Focus, [number]>(`
    SELECT * FROM focus
    WHERE project_id = ? AND cleared_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(projectId);

  if (!focus) {
    return null;
  }

  return {
    area: focus.area,
    files: focus.files ? JSON.parse(focus.files) : [],
    keywords: focus.keywords ? JSON.parse(focus.keywords) : [],
  };
}

// ============================================================================
// CLI Handler
// ============================================================================

export function handleFocusCommand(
  db: Database,
  projectId: number,
  args: string[]
): void {
  const subCmd = args[0];
  const subArgs = args.slice(1);

  switch (subCmd) {
    case "set": {
      const { values } = parseArgs({
        args: subArgs,
        options: {
          area: { type: "string", short: "a" },
          description: { type: "string", short: "d" },
          files: { type: "string", short: "f" },
          keywords: { type: "string", short: "k" },
        },
        allowPositionals: true,
      });

      // Allow area as positional argument
      const area = values.area || subArgs.find(a => !a.startsWith("-"));

      focusSet(db, projectId, {
        area: area || "",
        description: values.description,
        files: values.files ? JSON.parse(values.files) : undefined,
        keywords: values.keywords ? JSON.parse(values.keywords) : undefined,
      });
      break;
    }

    case "get":
      focusGet(db, projectId);
      break;

    case "clear":
      focusClear(db, projectId);
      break;

    case "list":
    case "history":
      focusList(db, projectId);
      break;

    default:
      // If no subcommand, treat as "get" or "set" based on args
      if (!subCmd || subCmd === "-h" || subCmd === "--help") {
        console.error("Usage: muninn focus <set|get|clear|list>");
        console.error("");
        console.error("Commands:");
        console.error("  set --area <area>     Set current focus area");
        console.error("  get                   Show current focus");
        console.error("  clear                 Clear current focus");
        console.error("  list                  Show focus history");
      } else {
        // Treat as implicit "set"
        focusSet(db, projectId, { area: subCmd });
      }
  }
}
