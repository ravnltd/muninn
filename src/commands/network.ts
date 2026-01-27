/**
 * Network commands
 * Manage network mode, sync status, and health monitoring
 */

import type { DatabaseAdapter } from "../database/adapter";
import { getConfig, getProjectDb } from "../database/connection";
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

  // If adapter has getHealth method (NetworkAdapter), use it
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

  // If in network mode but never synced, try to check primary reachability
  if (health.mode === "network" && !health.lastSyncAt && health.primaryUrl) {
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
    syncInterval: health.syncInterval,
  });
}

// ============================================================================
// Network Sync
// ============================================================================

export async function networkSync(adapter: DatabaseAdapter): Promise<void> {
  const config = getConfig();

  if (config.mode !== "network") {
    console.error("⚠️  Not in network mode. Set MUNINN_MODE=network to enable.");
    outputJson({ synced: false, error: "Not in network mode" });
    return;
  }

  console.error("🔄 Syncing to primary...");

  try {
    const start = performance.now();
    await adapter.sync();
    const latencyMs = Math.round(performance.now() - start);

    console.error(`✅ Sync complete (${latencyMs}ms)`);
    outputSuccess({ synced: true, latencyMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`❌ Sync failed: ${message}`);
    outputJson({ synced: false, error: message });
  }
}

// ============================================================================
// Network Init
// ============================================================================

export async function networkInit(args: string[]): Promise<void> {
  const config = getConfig();
  const pushLocal = args.includes("--push") || args.includes("--push-local");

  console.error("\n🌐 Network Mode Initialization\n");

  // Check configuration
  if (!process.env.MUNINN_PRIMARY_URL) {
    console.error("❌ MUNINN_PRIMARY_URL environment variable not set");
    console.error("\nSet up network mode:");
    console.error("  export MUNINN_MODE=network");
    console.error("  export MUNINN_PRIMARY_URL=http://your-server:8080");
    console.error("  export MUNINN_AUTH_TOKEN=optional-secret  # if using auth");
    console.error("\nThen run: muninn network init");
    outputJson({ initialized: false, error: "MUNINN_PRIMARY_URL not set" });
    return;
  }

  console.error(`  Mode: ${config.mode}`);
  console.error(`  Primary URL: ${config.primaryUrl || "not set"}`);
  console.error(`  Auth: ${config.authToken ? "configured" : "none"}`);
  console.error(`  Sync Interval: ${config.syncInterval}ms`);
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

  // If --push flag, attempt initial sync
  if (pushLocal && config.mode === "network") {
    console.error("\n  Pushing local data to primary...");

    try {
      const adapter = await getProjectDb();
      await adapter.sync();
      console.error("  ✅ Initial sync complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`  ⚠️  Initial sync failed: ${message}`);
      console.error("  Local data will sync on next interval or manual sync");
    }
  }

  console.error("\n✅ Network mode ready");
  console.error("\nUseful commands:");
  console.error("  muninn network status  # Check connection status");
  console.error("  muninn network sync    # Force immediate sync");
  console.error("");

  outputSuccess({
    initialized: true,
    mode: config.mode,
    primaryUrl: config.primaryUrl,
    syncInterval: config.syncInterval,
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

    case "sync":
      await networkSync(adapter);
      break;

    case "init":
      await networkInit(args.slice(1));
      break;

    default:
      if (!subCmd || subCmd === "-h" || subCmd === "--help") {
        console.error("Usage: muninn network <status|sync|init>");
        console.error("");
        console.error("Commands:");
        console.error("  status              Show network connection status");
        console.error("  sync                Force immediate sync to primary");
        console.error("  init [--push]       Initialize network mode, optionally push local data");
        console.error("");
        console.error("Environment variables:");
        console.error("  MUNINN_MODE=network           Enable network mode");
        console.error("  MUNINN_PRIMARY_URL=<url>      Primary sqld server URL");
        console.error("  MUNINN_AUTH_TOKEN=<token>     Optional auth token");
        console.error("  MUNINN_SYNC_INTERVAL=<ms>     Sync interval (default: 60000)");
      } else {
        console.error(`Unknown network command: ${subCmd}`);
        console.error("Run 'muninn network --help' for usage");
      }
  }
}
