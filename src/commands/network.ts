/**
 * Network commands
 * Manage HTTP mode and health monitoring
 */

import type { DatabaseAdapter } from "../database/adapter";
import { getConfig } from "../database/connection";
import { checkPrimaryReachable, formatHealthStatus, getLocalHealth, type NetworkHealth } from "../database/health";
import { outputJson, outputSuccess } from "../utils/format";

// ============================================================================
// Get Health
// ============================================================================

/**
 * Get network health from the adapter
 * Returns local health if in local mode or adapter doesn't support getHealth
 */
export function getNetworkHealth(adapter: DatabaseAdapter): NetworkHealth {
  const config = getConfig();

  // If adapter has getHealth method (HttpAdapter), use it
  if (adapter.getHealth) {
    return adapter.getHealth();
  }

  // Otherwise return local health
  return getLocalHealth(config);
}

// ============================================================================
// Network Status
// ============================================================================

export async function networkStatus(adapter: DatabaseAdapter): Promise<void> {
  const health = getNetworkHealth(adapter);

  console.error("\n🌐 Network Status:\n");
  console.error(`  ${formatHealthStatus(health).split("\n").join("\n  ")}`);

  // If in HTTP mode, check primary reachability
  if (health.mode === "http" && health.primaryUrl) {
    console.error("\n  Checking primary reachability...");
    const ping = await checkPrimaryReachable(health.primaryUrl);
    if (ping.ok) {
      console.error(`  Primary reachable: Yes (${ping.latencyMs}ms)`);
    } else {
      console.error(`  Primary reachable: No`);
      console.error(`  Error: ${ping.error}`);
    }
  }

  console.error("");

  outputJson({
    mode: health.mode,
    connected: health.connected,
    lastSyncAt: health.lastSyncAt?.toISOString() || null,
    lastSyncError: health.lastSyncError,
    latencyMs: health.lastSyncLatencyMs,
    primaryUrl: health.primaryUrl,
  });
}

// ============================================================================
// Network Init
// ============================================================================

export async function networkInit(): Promise<void> {
  const config = getConfig();

  console.error("\n🌐 HTTP Mode Initialization\n");

  // Check configuration
  if (!process.env.MUNINN_PRIMARY_URL) {
    console.error("❌ MUNINN_PRIMARY_URL environment variable not set");
    console.error("\nSet up HTTP mode:");
    console.error("  export MUNINN_MODE=http");
    console.error("  export MUNINN_PRIMARY_URL=http://your-server:8080");
    console.error("  export MUNINN_AUTH_TOKEN=optional-secret  # if using auth");
    console.error("\nThen run: muninn network init");
    outputJson({ initialized: false, error: "MUNINN_PRIMARY_URL not set" });
    return;
  }

  console.error(`  Mode: ${config.mode}`);
  console.error(`  Primary URL: ${config.primaryUrl || "not set"}`);
  console.error(`  Auth: ${config.authToken ? "configured" : "none"}`);
  console.error("");

  // Check primary reachability
  if (config.primaryUrl) {
    console.error("  Checking primary server...");
    const ping = await checkPrimaryReachable(config.primaryUrl);

    if (ping.ok) {
      console.error(`  ✅ Primary reachable (${ping.latencyMs}ms)`);
    } else {
      console.error(`  ❌ Primary unreachable: ${ping.error}`);
      console.error("\n  Make sure:");
      console.error("    1. sqld is running on the primary server");
      console.error("    2. The URL is correct and accessible");
      console.error("    3. Any firewalls allow the connection");
      outputJson({ initialized: false, error: "Primary unreachable", details: ping.error });
      return;
    }
  }

  console.error("\n✅ HTTP mode ready");
  console.error("\nUseful commands:");
  console.error("  muninn network status  # Check connection status");
  console.error("");

  outputSuccess({
    initialized: true,
    mode: config.mode,
    primaryUrl: config.primaryUrl,
  });
}

// ============================================================================
// CLI Handler
// ============================================================================

export async function handleNetworkCommand(adapter: DatabaseAdapter, args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "status":
      await networkStatus(adapter);
      break;

    case "init":
      await networkInit();
      break;

    default:
      if (!subCmd || subCmd === "-h" || subCmd === "--help") {
        console.error("Usage: muninn network <status|init>");
        console.error("");
        console.error("Commands:");
        console.error("  status              Show connection status");
        console.error("  init                Initialize HTTP mode and verify connection");
        console.error("");
        console.error("Environment variables:");
        console.error("  MUNINN_MODE=http              Enable HTTP mode");
        console.error("  MUNINN_PRIMARY_URL=<url>      Primary sqld server URL");
        console.error("  MUNINN_AUTH_TOKEN=<token>     Optional auth token");
      } else {
        console.error(`Unknown network command: ${subCmd}`);
        console.error("Run 'muninn network --help' for usage");
      }
  }
}
