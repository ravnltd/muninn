/**
 * Centralized Path Resolution
 *
 * Resolution order:
 *   1. MUNINN_HOME env var (explicit override)
 *   2. ~/.muninn/ (if it exists — new installs)
 *   3. ~/.claude/ (if it exists — legacy installs)
 *   4. ~/.muninn/ (default for fresh installs)
 *
 * Backward compatible: auto-detects existing ~/.claude/ installations.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME || "~";

function resolveHome(): string {
  if (process.env.MUNINN_HOME) {
    return process.env.MUNINN_HOME;
  }

  const muninnDir = join(HOME, ".muninn");
  const claudeDir = join(HOME, ".claude");

  if (existsSync(muninnDir)) return muninnDir;
  if (existsSync(claudeDir)) return claudeDir;

  return muninnDir;
}

let cachedHome: string | null = null;

export function getMuninnHome(): string {
  if (!cachedHome) {
    cachedHome = resolveHome();
  }
  return cachedHome;
}

export function getGlobalDbPath(): string {
  return join(getMuninnHome(), "memory.db");
}

export function getProjectDataDir(): string {
  // Project-local data uses .muninn/ or falls back to .claude/
  if (existsSync(".muninn")) return ".muninn";
  if (existsSync(".claude")) return ".claude";
  return ".muninn";
}

export function getMigrationLogPath(): string {
  return join(getMuninnHome(), "migrations.log");
}

export function getSchemaPath(): string {
  return join(getMuninnHome(), "schema.sql");
}

export function getBackupDir(): string {
  return join(getMuninnHome(), "backups");
}
