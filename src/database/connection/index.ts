/**
 * Database connection — barrel re-exports.
 *
 * Preserves the original public API of src/database/connection.ts
 * while splitting the implementation across focused modules.
 */

// Global database, config, constants, types, migration re-exports
export {
  GLOBAL_DB_PATH,
  LOCAL_DB_DIR,
  LOCAL_DB_NAME,
  SCHEMA_PATH,
  getConfig,
  getGlobalDb,
  getGlobalDrizzle,
  closeGlobalDb,
  getSchemaVersion,
  getLatestVersion,
  checkIntegrity,
  logDbError,
  type DrizzleDb,
  type MigrationState,
  type IntegrityCheck,
} from "./global.js";

// Re-export schema (lazy — only loads when accessed)
export * from "../schema.js";

// Project database
export {
  getProjectDbPath,
  getProjectDb,
  getProjectDrizzle,
  initProjectDb,
  closeProjectDb,
} from "./project.js";

// Project management + cleanup
export {
  ensureProject,
  closeAll,
} from "./ensure.js";
