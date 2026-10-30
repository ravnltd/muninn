// @muninn — context in .muninn/context/
/**
 * Configuration Loader
 *
 * Loads and validates Muninn configuration from environment variables.
 * Uses Zod for runtime validation to ensure config is valid on startup.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Configuration schema
const ConfigSchema = z.object({
  mode: z.enum(["local", "http"]).default("local"),
  primaryUrl: z.string().url().optional(),
  authToken: z.string().optional(),
  syncInterval: z.number().int().positive().default(60000),
  outputFormat: z.enum(["native", "human"]).default("native"),
});

export type MuninnConfig = z.infer<typeof ConfigSchema>;

// Machine-wide settings file. Hooks run the CLI with no MUNINN_* env, so
// without this file they silently fall back to local mode while the MCP
// server talks to the hub (the hook/MCP split brain).
const FileConfigSchema = z.object({
  mode: z.enum(["local", "http"]).optional(),
  primaryUrl: z.string().url().optional(),
  authToken: z.string().optional(),
});

type FileConfig = z.infer<typeof FileConfigSchema>;

export function configFilePath(): string {
  const home = process.env.MUNINN_HOME || join(process.env.HOME || homedir(), ".muninn");
  return join(home, "config.json");
}

function loadConfigFile(): FileConfig {
  const path = configFilePath();
  if (!existsSync(path)) return {};
  const result = FileConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
  if (!result.success) {
    throw new Error(`Invalid Muninn config file ${path}: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Load configuration. Resolution per field: environment → ~/.muninn/config.json → default.
 *
 * Environment variables:
 * - MUNINN_MODE: 'local' (default) or 'http'
 * - MUNINN_PRIMARY_URL: sqld server URL (required for http mode)
 * - MUNINN_AUTH_TOKEN: Optional auth token for http mode
 * - MUNINN_SYNC_INTERVAL: Sync interval in ms (default: 60000)
 */
export function loadConfig(): MuninnConfig {
  const file = loadConfigFile();
  const raw = {
    mode: process.env.MUNINN_MODE || file.mode || "local",
    primaryUrl: process.env.MUNINN_PRIMARY_URL || file.primaryUrl,
    authToken: process.env.MUNINN_AUTH_TOKEN || file.authToken,
    syncInterval: process.env.MUNINN_SYNC_INTERVAL
      ? parseInt(process.env.MUNINN_SYNC_INTERVAL, 10)
      : 60000,
    outputFormat: process.env.MUNINN_OUTPUT_FORMAT || "native",
  };

  // Validate with Zod
  const result = ConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Invalid Muninn configuration: ${result.error.message}`);
  }

  const config = result.data;

  // Additional validation: http mode requires primaryUrl
  if (config.mode === "http" && !config.primaryUrl) {
    throw new Error(
      `HTTP mode requires MUNINN_PRIMARY_URL (env) or primaryUrl in ${configFilePath()}`
    );
  }

  return config;
}

// Cached config instance (loaded once at startup)
let cachedConfig: MuninnConfig | null = null;

/**
 * Get the cached config or load it
 */
export function getConfig(): MuninnConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Check if native output format is enabled
 */
export function isNativeFormat(): boolean {
  return getConfig().outputFormat === "native";
}

/**
 * Get a human-readable status of the current config
 */
export function getConfigStatus(config: MuninnConfig): string {
  if (config.mode === "local") {
    return "Mode: Local (bun:sqlite)";
  }

  return [
    "Mode: HTTP (pure fetch, no native modules)",
    `Primary: ${config.primaryUrl}`,
    config.authToken ? "Auth: Enabled" : "Auth: None",
  ].join("\n");
}
