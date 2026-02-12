/**
 * Path normalization utilities.
 *
 * Converts any file path to project-relative form (e.g. "src/mcp-server.ts").
 * Applied at MCP entry points so all downstream code receives consistent paths.
 */

import { resolve, relative } from "node:path";

/**
 * Normalize a file path to project-relative form.
 * Handles: absolute paths, relative paths, ./prefixed paths.
 * If path escapes cwd (starts with ..), returns the original path unchanged.
 */
export function normalizePath(cwd: string, filePath: string): string {
  const abs = filePath.startsWith("/") ? filePath : resolve(cwd, filePath);
  const rel = relative(cwd, abs);
  return rel.startsWith("..") ? filePath : rel;
}

/**
 * Normalize an array of file paths to project-relative form.
 */
export function normalizePaths(cwd: string, files: string[]): string[] {
  return files.map((f) => normalizePath(cwd, f));
}
