#!/usr/bin/env bun
/**
 * Apply all pending migrations to the sqld HTTP database.
 *
 * The migration runner (runner.ts) only works with local bun:sqlite.
 * This script extracts the SQL from each migration and applies it
 * via the sqld HTTP pipeline endpoint.
 *
 * Usage: MUNINN_PRIMARY_URL=http://100.64.0.3:8080 bun run scripts/apply-migrations-http.ts
 */

const PRIMARY_URL = process.env.MUNINN_PRIMARY_URL || "http://100.64.0.3:8080";
const PIPELINE_URL = `${PRIMARY_URL}/v2/pipeline`;

interface HranaValue {
  type: string;
  value?: string | number | null;
}

interface HranaResult {
  type: string;
  response?: {
    type: string;
    result?: {
      cols: Array<{ name: string }>;
      rows: HranaValue[][];
    };
  };
  error?: { message: string; code: string };
}

interface PipelineResponse {
  results: HranaResult[];
}

async function execSql(sql: string): Promise<PipelineResponse> {
  const resp = await fetch(PIPELINE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ type: "execute", stmt: { sql } }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }
  return resp.json() as Promise<PipelineResponse>;
}

async function execBatch(statements: string[]): Promise<PipelineResponse> {
  const resp = await fetch(PIPELINE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          type: "batch",
          batch: {
            steps: statements.map((sql) => ({ stmt: { sql } })),
          },
        },
      ],
    }),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }
  return resp.json() as Promise<PipelineResponse>;
}

async function getSchemaVersion(): Promise<number> {
  const result = await execSql("PRAGMA user_version");
  const rows = result.results[0]?.response?.result?.rows;
  if (!rows || rows.length === 0) return 0;
  return Number(rows[0][0]?.value ?? 0);
}

/**
 * Strip inline SQL comments (-- ...) from a line, preserving string literals.
 */
function stripInlineComments(line: string): string {
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === "-" && i + 1 < line.length && line[i + 1] === "-") {
      return line.substring(0, i).trimEnd();
    }
  }
  return line;
}

/**
 * Split a migration SQL block into individual statements.
 * Handles multi-line statements, triggers, and views.
 * Strips inline comments that break sqld parsing.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inTrigger = false;

  for (const rawLine of sql.split("\n")) {
    const trimmed = rawLine.trim();

    // Skip full-line comments and empty lines
    if (trimmed.startsWith("--") || trimmed === "") {
      continue;
    }

    // Strip inline comments
    const cleaned = stripInlineComments(trimmed);
    if (!cleaned) continue;

    current += " " + cleaned;

    // Track BEGIN/END for triggers
    if (/\bBEGIN\b/i.test(cleaned) && !cleaned.toUpperCase().startsWith("BEGIN IMMEDIATE")) {
      inTrigger = true;
    }

    if (inTrigger && /\bEND;?\s*$/i.test(cleaned)) {
      inTrigger = false;
      const stmt = current.trim().replace(/;$/, "");
      if (stmt) statements.push(stmt);
      current = "";
      continue;
    }

    if (!inTrigger && cleaned.endsWith(";")) {
      const stmt = current.trim().replace(/;$/, "");
      if (stmt) statements.push(stmt);
      current = "";
    }
  }

  // Catch any remaining statement
  const remaining = current.trim().replace(/;$/, "");
  if (remaining) statements.push(remaining);

  return statements;
}

async function main() {
  console.log(`Connecting to sqld at ${PRIMARY_URL}...`);

  // Test connection
  try {
    await execSql("SELECT 1");
    console.log("Connected.\n");
  } catch (e) {
    console.error(`Cannot connect to ${PRIMARY_URL}:`, e);
    process.exit(1);
  }

  const currentVersion = await getSchemaVersion();
  console.log(`Current PRAGMA user_version: ${currentVersion}`);

  // Import migrations
  const { MIGRATIONS } = await import("../src/database/migrations/versions.js");

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    console.log("All migrations already applied.");
    return;
  }

  console.log(`${pending.length} migrations pending (v${pending[0].version} to v${pending[pending.length - 1].version})\n`);

  let applied = 0;

  for (const migration of pending.sort((a, b) => a.version - b.version)) {
    console.log(`Applying v${migration.version}: ${migration.name}...`);

    const statements = splitStatements(migration.up);

    // Apply each statement individually (sqld doesn't support multi-statement exec)
    let failed = false;
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        const result = await execSql(stmt);
        const r = result.results[0];
        if (r?.type === "error") {
          const errMsg = r.error?.message || "unknown error";
          // Skip "duplicate column" or "already exists" errors for ALTER TABLE
          if (
            errMsg.includes("duplicate column") ||
            errMsg.includes("already exists") ||
            errMsg.includes("table already exists")
          ) {
            console.log(`  [skip] Statement ${i + 1}: ${errMsg}`);
            continue;
          }
          console.error(`  [FAIL] Statement ${i + 1}: ${errMsg}`);
          console.error(`  SQL: ${stmt.substring(0, 200)}...`);
          failed = true;
          break;
        }
      } catch (err) {
        console.error(`  [FAIL] Statement ${i + 1}:`, err);
        console.error(`  SQL: ${stmt.substring(0, 200)}...`);
        failed = true;
        break;
      }
    }

    if (failed) {
      console.error(`\nMigration v${migration.version} failed. Stopping.`);
      console.log(`Applied ${applied} migrations successfully before failure.`);
      break;
    }

    // Update PRAGMA user_version
    await execSql(`PRAGMA user_version = ${migration.version}`);
    applied++;
    console.log(`  Applied v${migration.version} (${statements.length} statements)`);
  }

  const finalVersion = await getSchemaVersion();
  console.log(`\nDone. Applied ${applied} migrations. PRAGMA user_version is now ${finalVersion}.`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
