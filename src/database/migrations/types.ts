/**
 * Migration System Types
 */
import type { Database } from "bun:sqlite";

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: string;
  down?: string;
  validate?: (db: Database) => boolean;
}

export interface MigrationResult {
  version: number;
  name: string;
  status: "applied" | "skipped" | "failed";
  duration_ms: number;
  error?: string;
}

export interface MigrationState {
  current_version: number;
  latest_version: number;
  pending_count: number;
  applied: MigrationResult[];
}

export interface IntegrityCheck {
  valid: boolean;
  version: number;
  issues: string[];
  tables: { name: string; exists: boolean }[];
  indexes: { name: string; exists: boolean }[];
}
