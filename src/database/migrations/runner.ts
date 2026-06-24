// @muninn — context in .muninn/context/
/**
 * Migration Runner — Version management and atomic migration application
 *
 * Two modes:
 *   - runMigrations(db)       — sync, for local bun:sqlite
 *   - runMigrationsAsync(adapter) — async, for DatabaseAdapter (HTTP or local)
 */
import type { Database } from "bun:sqlite";
import type { DatabaseAdapter } from "../adapter.js";
import { ContextError, err, ok, type Result } from "../../utils/errors";
import { logMigration } from "./logger.js";
import type { Migration, MigrationResult, MigrationState } from "./types.js";
import { MIGRATIONS } from "./versions.js";

// ---------------------------------------------------------------------------
// Sync (bun:sqlite) — used by local project DB init
// ---------------------------------------------------------------------------

export function getSchemaVersion(db: Database): number {
  const result = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  return result?.user_version ?? 0;
}

export function setSchemaVersion(db: Database, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

export function getLatestVersion(): number {
  return MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}

export function getPendingMigrations(db: Database): Migration[] {
  const currentVersion = getSchemaVersion(db);
  return MIGRATIONS.filter((m) => m.version > currentVersion);
}

function applyMigration(db: Database, migration: Migration, dbPath: string): Result<MigrationResult> {
  const startTime = Date.now();

  logMigration(dbPath, migration.version, migration.name, "start");

  try {
    db.exec("BEGIN IMMEDIATE");

    try {
      db.exec(migration.up);

      if (migration.validate && !migration.validate(db)) {
        throw new Error(`Migration validation failed for ${migration.name}`);
      }

      setSchemaVersion(db, migration.version);

      try {
        db.run(`INSERT OR REPLACE INTO _migration_history (version, name, duration_ms) VALUES (?, ?, ?)`, [
          migration.version,
          migration.name,
          Date.now() - startTime,
        ]);
      } catch {
        // History table might not exist yet (for early migrations)
      }

      db.exec("COMMIT");

      const duration = Date.now() - startTime;
      logMigration(dbPath, migration.version, migration.name, "success");

      return ok({
        version: migration.version,
        name: migration.name,
        status: "applied",
        duration_ms: duration,
      });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMigration(dbPath, migration.version, migration.name, "failed", message);

    return err(
      new ContextError(`Migration ${migration.version} (${migration.name}) failed: ${message}`, "DB_QUERY_ERROR", {
        version: migration.version,
        name: migration.name,
      }),
    );
  }
}

export function runMigrations(db: Database, dbPath: string = "unknown"): Result<MigrationState> {
  const currentVersion = getSchemaVersion(db);
  const pending = getPendingMigrations(db);
  const results: MigrationResult[] = [];

  if (pending.length === 0) {
    return ok({
      current_version: currentVersion,
      latest_version: getLatestVersion(),
      pending_count: 0,
      applied: [],
    });
  }

  pending.sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const result = applyMigration(db, migration, dbPath);

    if (!result.ok) {
      return err(result.error);
    }

    results.push(result.value);
  }

  return ok({
    current_version: getSchemaVersion(db),
    latest_version: getLatestVersion(),
    pending_count: 0,
    applied: results,
  });
}

// ---------------------------------------------------------------------------
// Async (DatabaseAdapter) — works with HTTP and local adapters
// ---------------------------------------------------------------------------

/** Get schema version via adapter (PRAGMA user_version) */
async function getSchemaVersionAsync(adapter: DatabaseAdapter): Promise<number> {
  const result = await adapter.get<{ user_version: number }>("PRAGMA user_version");
  return result?.user_version ?? 0;
}

/** Set schema version via adapter */
async function setSchemaVersionAsync(adapter: DatabaseAdapter, version: number): Promise<void> {
  await adapter.run(`PRAGMA user_version = ${version}`);
}

/**
 * Strip inline SQL comments that break sqld HTTP parsing.
 * Preserves comments inside string literals.
 */
function stripInlineComments(line: string): string {
  let inStr = false;
  let strChar = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === strChar) inStr = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = true;
      strChar = ch;
      continue;
    }
    if (ch === "-" && i + 1 < line.length && line[i + 1] === "-") {
      return line.substring(0, i).trimEnd();
    }
  }
  return line;
}

/**
 * Split migration SQL into individual statements for HTTP execution.
 * Strips comments and handles triggers with BEGIN/END blocks.
 */
function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inTrigger = false;

  for (const rawLine of sql.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("--") || trimmed === "") continue;

    const cleaned = stripInlineComments(trimmed);
    if (!cleaned) continue;

    current += " " + cleaned;

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

  const remaining = current.trim().replace(/;$/, "");
  if (remaining) statements.push(remaining);

  return statements;
}

/** Apply a single migration via DatabaseAdapter */
async function applyMigrationAsync(
  adapter: DatabaseAdapter,
  migration: Migration,
): Promise<Result<MigrationResult>> {
  const startTime = Date.now();
  const label = `http`;

  logMigration(label, migration.version, migration.name, "start");

  try {
    const statements = splitMigrationStatements(migration.up);

    for (const stmt of statements) {
      try {
        await adapter.run(stmt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Skip benign "already exists" errors (idempotent re-runs). Match
        // case-insensitively — sqld/libsql may phrase/case these differently
        // than bun:sqlite. Log every skip so a silently half-applied migration
        // is diagnosable instead of invisible.
        const lower = msg.toLowerCase();
        if (
          lower.includes("duplicate column") ||
          lower.includes("already exists")
        ) {
          logMigration(label, migration.version, migration.name, "skip-benign", msg);
          continue;
        }
        throw e;
      }
    }

    // Set schema version (PRAGMA sent via adapter.run, not exec which filters PRAGMAs)
    await setSchemaVersionAsync(adapter, migration.version);

    // Record in migration history
    try {
      await adapter.run(
        "INSERT OR REPLACE INTO _migration_history (version, name, duration_ms) VALUES (?, ?, ?)",
        [migration.version, migration.name, Date.now() - startTime],
      );
    } catch {
      // History table might not exist yet
    }

    const duration = Date.now() - startTime;
    logMigration(label, migration.version, migration.name, "success");

    return ok({
      version: migration.version,
      name: migration.name,
      status: "applied",
      duration_ms: duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMigration(label, migration.version, migration.name, "failed", message);

    return err(
      new ContextError(
        `Migration ${migration.version} (${migration.name}) failed: ${message}`,
        "DB_QUERY_ERROR",
        { version: migration.version, name: migration.name },
      ),
    );
  }
}

/**
 * Run all pending migrations via DatabaseAdapter (async).
 * Works with both HTTP and local adapters.
 */
export async function runMigrationsAsync(
  adapter: DatabaseAdapter,
): Promise<Result<MigrationState>> {
  const currentVersion = await getSchemaVersionAsync(adapter);
  const pending = MIGRATIONS
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return ok({
      current_version: currentVersion,
      latest_version: getLatestVersion(),
      pending_count: 0,
      applied: [],
    });
  }

  const results: MigrationResult[] = [];

  for (const migration of pending) {
    const result = await applyMigrationAsync(adapter, migration);

    if (!result.ok) {
      return err(result.error);
    }

    results.push(result.value);
  }

  const finalVersion = await getSchemaVersionAsync(adapter);

  return ok({
    current_version: finalVersion,
    latest_version: getLatestVersion(),
    pending_count: 0,
    applied: results,
  });
}
