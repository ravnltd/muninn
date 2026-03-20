#!/usr/bin/env bun
/**
 * Generate schema.sql from the current database.
 *
 * Connects to sqld and dumps all CREATE statements into schema.sql.
 * This ensures schema.sql stays in sync with the migration system.
 *
 * Usage: MUNINN_PRIMARY_URL=http://100.64.0.3:8080 bun run scripts/generate-schema.ts
 */

const PRIMARY_URL = process.env.MUNINN_PRIMARY_URL || "http://100.64.0.3:8080";
const OUTPUT = "schema.sql";

async function query(sql: string): Promise<Array<Record<string, string>>> {
  const resp = await fetch(`${PRIMARY_URL}/v2/pipeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ type: "execute", stmt: { sql } }],
    }),
  });
  const data = await resp.json() as {
    results: Array<{
      response?: {
        result?: {
          cols: Array<{ name: string }>;
          rows: Array<Array<{ value?: string | number | null }>>;
        };
      };
    }>;
  };

  const result = data.results[0]?.response?.result;
  if (!result) return [];

  return result.rows.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < result.cols.length; i++) {
      obj[result.cols[i].name] = String(row[i]?.value ?? "");
    }
    return obj;
  });
}

async function main() {
  // Get current migration version
  const versionRows = await query("PRAGMA user_version");
  const version = versionRows[0]?.user_version ?? "unknown";

  const lines: string[] = [
    "-- Muninn Database Schema",
    `-- Auto-generated from database at migration v${version}`,
    `-- Generated: ${new Date().toISOString().split("T")[0]}`,
    "--",
    "-- DO NOT EDIT — regenerate with: bun run scripts/generate-schema.ts",
    "-- Source of truth: src/database/migrations/versions.ts",
    "",
    "PRAGMA foreign_keys = ON;",
    "",
  ];

  // Tables
  const tables = await query(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );

  lines.push("-- " + "=".repeat(76));
  lines.push(`-- TABLES (${tables.length})`);
  lines.push("-- " + "=".repeat(76));
  lines.push("");

  for (const t of tables) {
    lines.push(formatDdl(t.sql) + ";");
    lines.push("");
  }

  // Views
  const views = await query(
    `SELECT name, sql FROM sqlite_master WHERE type='view' AND sql IS NOT NULL ORDER BY name`,
  );

  if (views.length > 0) {
    lines.push("-- " + "=".repeat(76));
    lines.push(`-- VIEWS (${views.length})`);
    lines.push("-- " + "=".repeat(76));
    lines.push("");

    for (const v of views) {
      lines.push(formatDdl(v.sql) + ";");
      lines.push("");
    }
  }

  // Indexes (non-autoindex)
  const indexes = await query(
    `SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );

  if (indexes.length > 0) {
    lines.push("-- " + "=".repeat(76));
    lines.push(`-- INDEXES (${indexes.length})`);
    lines.push("-- " + "=".repeat(76));
    lines.push("");

    for (const idx of indexes) {
      lines.push(idx.sql + ";");
    }
    lines.push("");
  }

  // Triggers
  const triggers = await query(
    `SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY name`,
  );

  if (triggers.length > 0) {
    lines.push("-- " + "=".repeat(76));
    lines.push(`-- TRIGGERS (${triggers.length})`);
    lines.push("-- " + "=".repeat(76));
    lines.push("");

    for (const trig of triggers) {
      lines.push(formatDdl(trig.sql) + ";");
      lines.push("");
    }
  }

  // FTS tables
  const fts = await query(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND name LIKE 'fts_%' AND sql LIKE '%fts5%' ORDER BY name`,
  );

  if (fts.length > 0) {
    lines.push("-- " + "=".repeat(76));
    lines.push(`-- FTS5 VIRTUAL TABLES (${fts.length})`);
    lines.push("-- " + "=".repeat(76));
    lines.push("");

    for (const f of fts) {
      lines.push(f.sql + ";");
      lines.push("");
    }
  }

  const content = lines.join("\n");
  await Bun.write(OUTPUT, content);
  console.log(`Written ${OUTPUT} (${content.length} bytes, ${tables.length} tables, ${indexes.length} indexes, ${triggers.length} triggers)`);
}

/**
 * Format DDL with basic line-breaking for readability.
 * Inline CREATE TABLE statements get expanded.
 */
function formatDdl(sql: string): string {
  // If it's already multi-line, return as-is
  if (sql.includes("\n")) return sql;

  // Expand single-line CREATE TABLE to multi-line
  if (sql.startsWith("CREATE TABLE")) {
    return sql
      .replace(/\(\s*/, "(\n    ")
      .replace(/,\s*/g, ",\n    ")
      .replace(/\s*\)$/, "\n)");
  }

  return sql;
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
