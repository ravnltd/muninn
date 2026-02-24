/**
 * Database connection management — thin re-export.
 *
 * Implementation split into src/database/connection/ modules:
 *   global.ts      — getGlobalDb(), getGlobalDrizzle(), config, constants
 *   project.ts     — getProjectDb(), initProjectDb(), getProjectDrizzle()
 *   schema-init.ts — inline DDL statements
 *   repair.ts      — repairFtsIssues()
 *   ensure.ts      — ensureProject(), closeAll()
 *   index.ts       — barrel re-exports
 */
export * from "./connection/index.js";
