/**
 * Bookmark commands
 * Session-scoped working memory for Claude
 * Allows Claude to "set aside" context and recall it later
 */

import type { Database } from "bun:sqlite";
import { outputJson, outputSuccess } from "../utils/format";
import { parseArgs } from "util";

// ============================================================================
// Types
// ============================================================================

interface Bookmark {
  id: number;
  session_id: number | null;
  project_id: number;
  label: string;
  content: string;
  source: string | null;
  content_type: string;
  priority: number;
  tags: string | null;
  created_at: string;
  expires_at: string | null;
}

interface BookmarkAddOptions {
  label: string;
  content: string;
  source?: string;
  contentType?: string;
  priority?: number;
  tags?: string[];
}

// ============================================================================
// Add Bookmark
// ============================================================================

export function bookmarkAdd(
  db: Database,
  projectId: number,
  options: BookmarkAddOptions
): void {
  const { label, content, source, contentType, priority, tags } = options;

  if (!label || !content) {
    console.error("Usage: context bookmark add --label <label> --content <content>");
    console.error("Options:");
    console.error("  --source <src>      Source reference (e.g., 'file:path:lines')");
    console.error("  --type <type>       Content type: text, code, json, markdown");
    console.error("  --priority <1-5>    Priority (1 = highest)");
    console.error("  --tags <json>       JSON array of tags");
    process.exit(1);
  }

  db.run(`
    INSERT INTO bookmarks (project_id, label, content, source, content_type, priority, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, label) DO UPDATE SET
      content = excluded.content,
      source = excluded.source,
      content_type = excluded.content_type,
      priority = excluded.priority,
      tags = excluded.tags,
      created_at = CURRENT_TIMESTAMP
  `, [
    projectId,
    label,
    content,
    source || null,
    contentType || "text",
    priority || 3,
    tags ? JSON.stringify(tags) : null,
  ]);

  console.error(`📌 Bookmark '${label}' saved`);
  outputSuccess({ label, saved: true });
}

// ============================================================================
// Get Bookmark
// ============================================================================

export function bookmarkGet(
  db: Database,
  projectId: number,
  label: string
): Bookmark | null {
  if (!label) {
    console.error("Usage: context bookmark get <label>");
    process.exit(1);
  }

  const bookmark = db.query<Bookmark, [number, string]>(`
    SELECT * FROM bookmarks
    WHERE project_id = ? AND label = ?
  `).get(projectId, label);

  if (!bookmark) {
    console.error(`❌ Bookmark '${label}' not found`);
    outputJson({ error: "not_found", label });
    return null;
  }

  console.error(`📌 ${bookmark.label}`);
  if (bookmark.source) {
    console.error(`   Source: ${bookmark.source}`);
  }
  console.error(`   Type: ${bookmark.content_type}`);
  console.error(`   Priority: ${bookmark.priority}`);
  console.error("");
  console.error(bookmark.content);

  outputJson(bookmark);
  return bookmark;
}

// ============================================================================
// List Bookmarks
// ============================================================================

export function bookmarkList(db: Database, projectId: number): Bookmark[] {
  const bookmarks = db.query<Bookmark, [number]>(`
    SELECT * FROM bookmarks
    WHERE project_id = ?
    ORDER BY priority ASC, created_at DESC
  `).all(projectId);

  if (bookmarks.length === 0) {
    console.error("📌 No bookmarks found");
    outputJson([]);
    return [];
  }

  console.error(`📌 ${bookmarks.length} bookmark(s):\n`);

  for (const bm of bookmarks) {
    const preview = bm.content.substring(0, 60).replace(/\n/g, " ");
    const ellipsis = bm.content.length > 60 ? "..." : "";
    const tags = bm.tags ? ` [${JSON.parse(bm.tags).join(", ")}]` : "";
    console.error(`  [P${bm.priority}] ${bm.label}${tags}`);
    console.error(`      ${preview}${ellipsis}`);
  }

  outputJson(bookmarks);
  return bookmarks;
}

// ============================================================================
// Delete Bookmark
// ============================================================================

export function bookmarkDelete(
  db: Database,
  projectId: number,
  label: string
): boolean {
  if (!label) {
    console.error("Usage: context bookmark delete <label>");
    process.exit(1);
  }

  const result = db.run(`
    DELETE FROM bookmarks
    WHERE project_id = ? AND label = ?
  `, [projectId, label]);

  if (result.changes === 0) {
    console.error(`❌ Bookmark '${label}' not found`);
    outputJson({ deleted: false, label });
    return false;
  }

  console.error(`🗑️  Bookmark '${label}' deleted`);
  outputSuccess({ deleted: true, label });
  return true;
}

// ============================================================================
// Clear All Bookmarks
// ============================================================================

export function bookmarkClear(db: Database, projectId: number): number {
  const result = db.run(`
    DELETE FROM bookmarks WHERE project_id = ?
  `, [projectId]);

  console.error(`🗑️  Cleared ${result.changes} bookmark(s)`);
  outputSuccess({ cleared: result.changes });
  return result.changes;
}

// ============================================================================
// CLI Handler
// ============================================================================

export function handleBookmarkCommand(
  db: Database,
  projectId: number,
  args: string[]
): void {
  const subCmd = args[0];
  const subArgs = args.slice(1);

  switch (subCmd) {
    case "add": {
      const { values } = parseArgs({
        args: subArgs,
        options: {
          label: { type: "string", short: "l" },
          content: { type: "string", short: "c" },
          source: { type: "string", short: "s" },
          type: { type: "string", short: "t" },
          priority: { type: "string", short: "p" },
          tags: { type: "string" },
        },
        allowPositionals: true,
      });

      bookmarkAdd(db, projectId, {
        label: values.label || "",
        content: values.content || "",
        source: values.source,
        contentType: values.type,
        priority: values.priority ? parseInt(values.priority) : undefined,
        tags: values.tags ? JSON.parse(values.tags) : undefined,
      });
      break;
    }

    case "get": {
      const label = subArgs[0];
      bookmarkGet(db, projectId, label);
      break;
    }

    case "list":
      bookmarkList(db, projectId);
      break;

    case "delete":
    case "remove": {
      const label = subArgs[0];
      bookmarkDelete(db, projectId, label);
      break;
    }

    case "clear":
      bookmarkClear(db, projectId);
      break;

    default:
      console.error("Usage: context bookmark <add|get|list|delete|clear>");
      console.error("");
      console.error("Commands:");
      console.error("  add --label <l> --content <c>  Save a bookmark");
      console.error("  get <label>                    Retrieve a bookmark");
      console.error("  list                           List all bookmarks");
      console.error("  delete <label>                 Delete a bookmark");
      console.error("  clear                          Clear all bookmarks");
  }
}
