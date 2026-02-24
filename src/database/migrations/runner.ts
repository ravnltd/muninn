/**
 * Migration Runner — Version management and atomic migration application
 */
import type { Database } from "bun:sqlite";
import { ContextError, err, ok, type Result } from "../../utils/errors";
import { logMigration } from "./logger.js";
import type { Migration, MigrationResult, MigrationState } from "./types.js";
import { MIGRATIONS } from "./versions.js";

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
