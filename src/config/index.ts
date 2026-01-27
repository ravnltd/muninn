/**
 * Configuration Loader
 *
 * Loads and validates Muninn configuration from environment variables.
 * Uses Zod for runtime validation to ensure config is valid on startup.
 */

import { z } from "zod";

// Configuration schema
const ConfigSchema = z.object({
  mode: z.enum(["local", "network"]).default("local"),
  primaryUrl: z.string().url().optional(),
  authToken: z.string().optional(),
  syncInterval: z.number().int().positive().default(60000),
});

export type MuninnConfig = z.infer<typeof ConfigSchema>;

/**
 * Load configuration from environment variables
 *
 * Environment variables:
 * - MUNINN_MODE: 'local' (default) or 'network'
 * - MUNINN_PRIMARY_URL: sqld server URL (required for network mode)
 * - MUNINN_AUTH_TOKEN: Optional auth token for network mode
 * - MUNINN_SYNC_INTERVAL: Sync interval in ms (default: 60000)
 */
export function loadConfig(): MuninnConfig {
  const raw = {
    mode: process.env.MUNINN_MODE || "local",
    primaryUrl: process.env.MUNINN_PRIMARY_URL,
    authToken: process.env.MUNINN_AUTH_TOKEN,
    syncInterval: process.env.MUNINN_SYNC_INTERVAL
      ? parseInt(process.env.MUNINN_SYNC_INTERVAL, 10)
      : 60000,
  };

  // Validate with Zod
  const result = ConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Invalid Muninn configuration: ${result.error.message}`);
  }

  const config = result.data;

  // Additional validation: network mode requires primaryUrl
  if (config.mode === "network" && !config.primaryUrl) {
    throw new Error(
      "Network mode requires MUNINN_PRIMARY_URL environment variable"
    );
  }

  return config;
}

/**
 * Get a human-readable status of the current config
 */
export function getConfigStatus(config: MuninnConfig): string {
  if (config.mode === "local") {
    return "Mode: Local (bun:sqlite)";
  }

  return [
    "Mode: Network (libSQL embedded replica)",
    `Primary: ${config.primaryUrl}`,
    `Sync interval: ${config.syncInterval}ms`,
    config.authToken ? "Auth: Enabled" : "Auth: None",
  ].join("\n");
}
