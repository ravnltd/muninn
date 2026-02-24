/**
 * Database Pragmas — Connection-level reliability and performance settings
 */
import type { Database } from "bun:sqlite";

export function applyReliabilityPragmas(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -64000");
  db.exec("PRAGMA temp_store = MEMORY");
}

export function optimizeDatabase(db: Database): void {
  try {
    db.exec("PRAGMA optimize");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // Non-critical, ignore failures
  }
}
