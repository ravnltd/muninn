/**
 * Database Migration System — Barrel Export
 *
 * Re-exports all migration system components for backward compatibility.
 */
export type { Migration, MigrationResult, MigrationState, IntegrityCheck } from "./types.js";
export { MIGRATIONS } from "./versions.js";
export { logMigration, LOG_PATH } from "./logger.js";
export {
  getSchemaVersion,
  setSchemaVersion,
  getLatestVersion,
  getPendingMigrations,
  runMigrations,
  runMigrationsAsync,
} from "./runner.js";
export { checkIntegrity, logDbError, getRecentErrors } from "./integrity.js";
export { applyReliabilityPragmas, optimizeDatabase } from "./pragmas.js";
