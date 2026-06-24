/**
 * List, Show, Search — Memory Inspection Commands
 *
 * Subcommands for the muninn passthrough tool:
 *   muninn list decisions [--limit N] [--status X] [--all]
 *   muninn show <ID|D435|L23|I17>
 *   muninn search <query>
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Helpers
// ============================================================================

function parseFlag(args: string[], flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function escapeFtsQuery(query: string): string {
  const stopWords = new Set(["and", "or", "not", "near"]);
  const words = query
    .replace(/[`$(){}|;&<>\\]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !stopWords.has(w.toLowerCase()));
  if (words.length === 0) return "";
  return words.map((w) => `"${w}"`).join(" ");
}

// ============================================================================
// List
// ============================================================================

export async function handleListCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[],
): Promise<void> {
  const entityType = args[0]?.toLowerCase();
  if (!entityType || !["decisions", "learnings", "issues"].includes(entityType)) {
    console.error("Usage: muninn list <decisions|learnings|issues> [--limit N] [--status X] [--all]");
    return;
  }

  const limit = parseInt(parseFlag(args, "--limit", "20"), 10);
  const statusFilter = parseFlag(args, "--status", "");
  const showAll = hasFlag(args, "--all");

  try {
    switch (entityType) {
      case "decisions": {
        let sql = "SELECT id, title, status, outcome_status, created_at FROM decisions WHERE project_id = ?";
        const params: unknown[] = [projectId];
        if (!showAll) {
          if (statusFilter) {
            sql += " AND status = ?";
            params.push(statusFilter);
          } else {
            sql += " AND status = 'active'";
          }
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(limit);
        const rows = await db.all<{
          id: number; title: string; status: string;
          outcome_status: string | null; created_at: string;
        }>(sql, params);
        if (rows.length === 0) { console.error("No decisions found."); return; }
        console.error(`\nDecisions (${rows.length}):\n`);
        for (const r of rows) {
          const outcome = r.outcome_status && r.outcome_status !== "pending" ? ` [${r.outcome_status}]` : "";
          const date = r.created_at?.slice(0, 10) ?? "";
          console.error(`  D#${r.id} | ${r.status.padEnd(10)} | ${r.title.slice(0, 50).padEnd(50)} | ${date}${outcome}`);
        }
        break;
      }
      case "learnings": {
        let sql = "SELECT id, title, category, confidence, stage, created_at FROM learnings WHERE project_id = ?";
        const params: unknown[] = [projectId];
        if (!showAll) sql += " AND archived_at IS NULL";
        sql += " ORDER BY confidence DESC LIMIT ?";
        params.push(limit);
        const rows = await db.all<{
          id: number; title: string; category: string;
          confidence: number; stage: string | null; created_at: string;
        }>(sql, params);
        if (rows.length === 0) { console.error("No learnings found."); return; }
        console.error(`\nLearnings (${rows.length}):\n`);
        for (const r of rows) {
          const stage = r.stage ? ` [${r.stage}]` : "";
          const date = r.created_at?.slice(0, 10) ?? "";
          console.error(`  L#${r.id} | ${(r.category ?? "").padEnd(12)} | conf:${r.confidence} | ${r.title.slice(0, 45).padEnd(45)} | ${date}${stage}`);
        }
        break;
      }
      case "issues": {
        let sql = "SELECT id, title, severity, type, status, created_at FROM issues WHERE project_id = ?";
        const params: unknown[] = [projectId];
        if (!showAll) {
          if (statusFilter) {
            sql += " AND status = ?";
            params.push(statusFilter);
          } else {
            sql += " AND status = 'open'";
          }
        }
        sql += " ORDER BY severity DESC LIMIT ?";
        params.push(limit);
        const rows = await db.all<{
          id: number; title: string; severity: number;
          type: string; status: string; created_at: string;
        }>(sql, params);
        if (rows.length === 0) { console.error("No issues found."); return; }
        console.error(`\nIssues (${rows.length}):\n`);
        for (const r of rows) {
          const date = r.created_at?.slice(0, 10) ?? "";
          console.error(`  I#${r.id} | sev:${r.severity} | ${(r.type ?? "bug").padEnd(12)} | ${r.status.padEnd(8)} | ${r.title.slice(0, 40).padEnd(40)} | ${date}`);
        }
        break;
      }
    }
  } catch (error) {
    console.error(`Error listing ${entityType}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================================================
// Show
// ============================================================================

export async function handleShowCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[],
): Promise<void> {
  const raw = args[0];
  if (!raw) {
    console.error("Usage: muninn show <ID|D435|L23|I17>");
    return;
  }

  let prefix = "";
  let id: number;
  const match = raw.match(/^([DLI])(\d+)$/i);
  if (match) {
    prefix = match[1].toUpperCase();
    id = parseInt(match[2], 10);
  } else {
    id = parseInt(raw, 10);
  }

  if (!id || isNaN(id)) {
    console.error(`Invalid ID: ${raw}`);
    return;
  }

  try {
    // Try decisions
    if (!prefix || prefix === "D") {
      const d = await db.get<Record<string, unknown>>(
        "SELECT * FROM decisions WHERE id = ? AND project_id = ?",
        [id, projectId],
      );
      if (d) {
        console.error(`\nDecision #${d.id}`);
        console.error(`  Title:       ${d.title}`);
        console.error(`  Status:      ${d.status}${d.superseded_by ? ` (superseded by D#${d.superseded_by})` : ""}`);
        console.error(`  Outcome:     ${d.outcome_status ?? "pending"}${d.outcome_notes ? ` — ${d.outcome_notes}` : ""}`);
        console.error(`  Decision:    ${d.decision}`);
        if (d.reasoning && d.reasoning !== d.decision) console.error(`  Reasoning:   ${d.reasoning}`);
        if (d.alternatives) console.error(`  Alternatives: ${d.alternatives}`);
        if (d.consequences) console.error(`  Revisit when: ${d.consequences}`);
        if (d.affects) console.error(`  Affects:     ${d.affects}`);
        if (d.invariant) console.error(`  Invariant:   ${d.invariant}`);
        if (d.durability) console.error(`  Durability:  ${d.durability}`);
        console.error(`  Created:     ${d.created_at ?? d.decided_at ?? ""}`);
        return;
      }
    }

    // Try learnings
    if (!prefix || prefix === "L") {
      const l = await db.get<Record<string, unknown>>(
        "SELECT * FROM learnings WHERE id = ? AND project_id = ?",
        [id, projectId],
      );
      if (l) {
        console.error(`\nLearning #${l.id}`);
        console.error(`  Title:       ${l.title}`);
        console.error(`  Category:    ${l.category}`);
        console.error(`  Confidence:  ${l.confidence}`);
        console.error(`  Stage:       ${l.stage ?? "unknown"}`);
        console.error(`  Content:     ${l.content}`);
        if (l.context) console.error(`  Context:     ${l.context}`);
        if (l.durability) console.error(`  Durability:  ${l.durability}`);
        console.error(`  Applied:     ${l.times_applied ?? 0} times`);
        console.error(`  Created:     ${l.created_at ?? ""}`);
        return;
      }
    }

    // Try issues
    if (!prefix || prefix === "I") {
      const i = await db.get<Record<string, unknown>>(
        "SELECT * FROM issues WHERE id = ? AND project_id = ?",
        [id, projectId],
      );
      if (i) {
        console.error(`\nIssue #${i.id}`);
        console.error(`  Title:       ${i.title}`);
        console.error(`  Type:        ${i.type ?? "bug"}`);
        console.error(`  Severity:    ${i.severity}`);
        console.error(`  Status:      ${i.status}`);
        if (i.description) console.error(`  Description: ${i.description}`);
        if (i.affected_files) console.error(`  Files:       ${i.affected_files}`);
        if (i.resolution) console.error(`  Resolution:  ${i.resolution}`);
        if (i.resolved_at) console.error(`  Resolved:    ${i.resolved_at}`);
        console.error(`  Created:     ${i.created_at ?? ""}`);
        return;
      }
    }

    console.error(`Record #${id} not found.`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================================================
// Search
// ============================================================================

export async function handleSearchCommand(
  db: DatabaseAdapter,
  projectId: number,
  args: string[],
): Promise<void> {
  const query = args.join(" ").trim();
  if (!query) {
    console.error("Usage: muninn search <query>");
    return;
  }

  const ftsQuery = escapeFtsQuery(query);
  if (!ftsQuery) {
    console.error("No searchable terms in query.");
    return;
  }

  const results: Array<{ type: string; id: number; title: string }> = [];

  try {
    const decisions = await db.all<{ id: number; title: string }>(
      `SELECT d.id, d.title FROM fts_decisions
       JOIN decisions d ON fts_decisions.rowid = d.id
       WHERE fts_decisions MATCH ? AND d.project_id = ? AND d.status = 'active'
       ORDER BY bm25(fts_decisions) LIMIT 5`,
      [ftsQuery, projectId],
    ).catch(() => [] as Array<{ id: number; title: string }>);
    for (const d of decisions) results.push({ type: "D", id: d.id, title: d.title });

    const learnings = await db.all<{ id: number; title: string }>(
      `SELECT l.id, l.title FROM fts_learnings
       JOIN learnings l ON fts_learnings.rowid = l.id
       WHERE fts_learnings MATCH ? AND l.project_id = ?
       ORDER BY bm25(fts_learnings) LIMIT 5`,
      [ftsQuery, projectId],
    ).catch(() => [] as Array<{ id: number; title: string }>);
    for (const l of learnings) results.push({ type: "L", id: l.id, title: l.title });

    const issues = await db.all<{ id: number; title: string }>(
      `SELECT i.id, i.title FROM fts_issues
       JOIN issues i ON fts_issues.rowid = i.id
       WHERE fts_issues MATCH ? AND i.project_id = ?
       ORDER BY bm25(fts_issues) LIMIT 5`,
      [ftsQuery, projectId],
    ).catch(() => [] as Array<{ id: number; title: string }>);
    for (const i of issues) results.push({ type: "I", id: i.id, title: i.title });

    if (results.length === 0) {
      console.error(`No results for "${query}".`);
      return;
    }

    console.error(`\nSearch: "${query}" (${results.length} results)\n`);
    for (const r of results) {
      console.error(`  ${r.type}#${r.id} ${r.title}`);
    }
  } catch (error) {
    console.error(`Search error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
