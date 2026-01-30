/**
 * Database query utilities
 * Common helpers for safe query construction
 */

// ============================================================================
// Table Name Validation
// ============================================================================

const ALLOWED_TABLES = new Set([
  "files",
  "decisions",
  "issues",
  "learnings",
  "symbols",
  "observations",
  "open_questions",
] as const);

type AllowedTable = (typeof ALLOWED_TABLES) extends Set<infer T> ? T : never;

/**
 * Validate that a table name is in the allowed set.
 * Throws if the table name is invalid.
 * This prevents SQL injection via dynamic table names.
 */
export function validateTableName(table: string): AllowedTable {
  if (!ALLOWED_TABLES.has(table as AllowedTable)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  return table as AllowedTable;
}

/**
 * Check if a table name is valid without throwing
 */
export function isValidTableName(table: string): table is AllowedTable {
  return ALLOWED_TABLES.has(table as AllowedTable);
}
