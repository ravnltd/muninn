/**
 * Database Migration System — Re-export from split modules
 *
 * This file is a backward-compatible re-export. All implementation
 * now lives in src/database/migrations/ directory.
 */
export {
  type Migration,
  type MigrationResult,
  type MigrationState,
  type IntegrityCheck,
  MIGRATIONS,
  logMigration,
  LOG_PATH,
  getSchemaVersion,
  setSchemaVersion,
  getLatestVersion,
  getPendingMigrations,
  runMigrations,
  checkIntegrity,
  logDbError,
  getRecentErrors,
  applyReliabilityPragmas,
  optimizeDatabase,
} from "./migrations/index.js";
