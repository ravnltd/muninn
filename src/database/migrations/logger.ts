/**
 * Migration Log — Append-only file log for migration events
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { getMuninnHome, getMigrationLogPath } from "../../paths.js";

export const LOG_PATH = getMigrationLogPath();

export function logMigration(
  dbPath: string,
  version: number,
  name: string,
  status: "start" | "success" | "failed",
  error?: string,
): void {
  const dir = getMuninnHome();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const line = `${JSON.stringify({ timestamp, dbPath, version, name, status, error })}\n`;

  try {
    appendFileSync(LOG_PATH, line);
  } catch {
    // Ignore log failures - don't break migrations
  }
}
