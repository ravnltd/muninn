/**
 * Database commands
 * Handles: db check, version, migrate, errors, optimize
 */

import type { Database } from "bun:sqlite";
import { checkIntegrity, getLatestVersion, getProjectDbPath, getSchemaVersion } from "../database/connection";
import { getPendingMigrations, getRecentErrors, optimizeDatabase, runMigrations } from "../database/migrations";
import { outputSuccess } from "../utils/format";

/**
 * Handle all database subcommands
 */
export function handleDatabaseCommand(db: Database, subArgs: string[]): void {
  const dbCmd = subArgs[0];

  switch (dbCmd) {
    case "check": {
      const integrity = checkIntegrity(db);
      console.error(`\n🔍 Database Integrity Check\n`);
      console.error(`Version: ${integrity.version}/${getLatestVersion()}`);
      console.error(`Status: ${integrity.valid ? "✅ Valid" : "❌ Issues Found"}\n`);

      if (integrity.issues.length > 0) {
        console.error("Issues:");
        for (const issue of integrity.issues) {
          console.error(`  ⚠️  ${issue}`);
        }
        console.error("");
      }

      const missingTables = integrity.tables.filter((t) => !t.exists);
      if (missingTables.length > 0) {
        console.error(`Missing tables: ${missingTables.map((t) => t.name).join(", ")}`);
      }

      const missingIndexes = integrity.indexes.filter((i) => !i.exists);
      if (missingIndexes.length > 0) {
        console.error(`Missing indexes: ${missingIndexes.map((i) => i.name).join(", ")}`);
      }

      outputSuccess({ ...integrity });
      break;
    }

    case "version": {
      const current = getSchemaVersion(db);
      const latest = getLatestVersion();
      const pending = getPendingMigrations(db);
      console.error(`Schema version: ${current}/${latest}`);
      if (pending.length > 0) {
        console.error(`Pending migrations: ${pending.length}`);
        for (const m of pending) {
          console.error(`  - v${m.version}: ${m.name}`);
        }
      }
      outputSuccess({ current, latest, pending: pending.length });
      break;
    }

    case "migrate": {
      console.error("Running migrations...");
      const result = runMigrations(db, getProjectDbPath());
      if (result.ok) {
        if (result.value.applied.length === 0) {
          console.error("✅ Already up to date");
        } else {
          console.error(`✅ Applied ${result.value.applied.length} migration(s)`);
          for (const m of result.value.applied) {
            console.error(`  - v${m.version}: ${m.name} (${m.duration_ms}ms)`);
          }
        }
        outputSuccess({ ...result.value });
      } else {
        console.error(`❌ Migration failed: ${result.error.message}`);
        process.exit(1);
      }
      break;
    }

    case "errors": {
      const limit = parseInt(subArgs[1], 10) || 20;
      const errors = getRecentErrors(db, limit);
      if (errors.length === 0) {
        console.error("No recent errors");
      } else {
        console.error(`\n📋 Recent Errors (${errors.length})\n`);
        for (const err of errors) {
          console.error(`[${err.timestamp}] [${err.source}] ${err.message}`);
        }
      }
      outputSuccess({ count: errors.length, errors });
      break;
    }

    case "optimize": {
      console.error("Optimizing database...");
      optimizeDatabase(db);
      console.error("✅ Database optimized");
      outputSuccess({ optimized: true });
      break;
    }

    default:
      console.error("Usage: muninn db <check|version|migrate|errors|optimize>");
  }
}
