/**
 * Network commands
 * Manage network mode, sync status, and health monitoring
 */

import { createClient } from "@libsql/client";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import type { DatabaseAdapter } from "../database/adapter";
import { getConfig, getGlobalDb, getProjectDb } from "../database/connection";
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
// Network Migrate
// ============================================================================

/**
 * Tables to migrate from project databases
 * Order matters for foreign key constraints
 */
const PROJECT_TABLES = [
  "projects",
  "files",
  "symbols",
  "decisions",
  "issues",
  "sessions",
  "learnings",
  "relationships",
  "bookmarks",
  "focus",
  "file_correlations",
  "session_learnings",
  "blast_radius",
  "blast_summary",
  "observations",
  "open_questions",
  "workflow_patterns",
  "developer_profile",
  "insights",
  "decision_links",
  "mode_transitions",
  "consolidations",
  "security_findings",
  "dependency_vulnerabilities",
  "quality_metrics",
  "performance_findings",
];

/**
 * Tables to migrate from global database
 * Order matters for foreign key constraints
 */
const GLOBAL_TABLES = [
  "projects",
  "global_learnings",
  "patterns",
  "quality_standards",
  "tech_debt",
  "ship_history",
  "global_observations",
  "global_open_questions",
  "global_workflow_patterns",
  "global_developer_profile",
  "servers",
  "services",
  "routes",
  "service_deps",
  "deployments",
  "infra_events",
];

interface MigrationStats {
  table: string;
  rowsCopied: number;
  skipped: number;
}

/**
 * Migrate data from a bun:sqlite backup to the current network-mode database
 */
export async function networkMigrate(
  adapter: DatabaseAdapter,
  backupPath: string,
  isGlobal: boolean
): Promise<void> {
  const config = getConfig();

  if (config.mode !== "network") {
    console.error("❌ Not in network mode. Set MUNINN_MODE=network to enable.");
    outputJson({ migrated: false, error: "Not in network mode" });
    return;
  }

  if (!config.primaryUrl) {
    console.error("❌ Primary URL not configured for network mode.");
    outputJson({ migrated: false, error: "Primary URL not configured" });
    return;
  }

  // Verify backup file exists
  if (!existsSync(backupPath)) {
    console.error(`❌ Backup file not found: ${backupPath}`);
    outputJson({ migrated: false, error: "Backup file not found" });
    return;
  }

  console.error(`\n🔄 Migrating from backup: ${backupPath}`);
  console.error(`   Target: ${isGlobal ? "Global DB" : "Project DB"}\n`);

  // Open backup with bun:sqlite (read-only)
  let backupDb: Database;
  try {
    backupDb = new Database(backupPath, { readonly: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`❌ Failed to open backup: ${message}`);
    outputJson({ migrated: false, error: `Failed to open backup: ${message}` });
    return;
  }

  // Create direct connection to primary for migration writes
  // This bypasses the embedded replica to avoid corruption
  const directClient = createClient({
    url: config.primaryUrl,
    authToken: config.authToken,
  });

  const tables = isGlobal ? GLOBAL_TABLES : PROJECT_TABLES;
  const stats: MigrationStats[] = [];
  let totalRows = 0;
  let totalSkipped = 0;

  // For project DBs, build a mapping from old project_id to new project_id
  // based on matching project paths
  const projectIdMap = new Map<number, number>();
  if (!isGlobal) {
    const backupProjects = backupDb.query<{ id: number; path: string }, []>(
      "SELECT id, path FROM projects"
    ).all();

    for (const bp of backupProjects) {
      // Use direct client to query primary
      const projectResult = await directClient.execute({
        sql: "SELECT id FROM projects WHERE path = ?",
        args: [bp.path],
      });
      const row = projectResult.rows[0];
      if (row) {
        const currentProjectId = row.id as number;
        projectIdMap.set(bp.id, currentProjectId);
        console.error(`   📎 Project mapping: ${bp.id} → ${currentProjectId} (${bp.path})`);
      }
    }

    if (projectIdMap.size === 0) {
      console.error("   ⚠️  No project ID mappings found - data may not migrate correctly");
    }
    console.error("");
  }

  try {
    for (const table of tables) {
      // Check if table exists in backup
      const tableExists = backupDb
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        )
        .get(table);

      if (!tableExists) {
        console.error(`   ⏭️  ${table}: not in backup (skipped)`);
        continue;
      }

      // Get all rows from backup
      const rows = backupDb.query(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];

      if (rows.length === 0) {
        console.error(`   ⏭️  ${table}: empty (skipped)`);
        continue;
      }

      // Get column names from first row (backup)
      const backupColumns = Object.keys(rows[0]);

      // Get column names from target table to handle schema differences
      const targetColumnsResult = await directClient.execute({
        sql: `PRAGMA table_info(${table})`,
        args: [],
      });
      const targetColumns = new Set(targetColumnsResult.rows.map((r) => r.name as string));

      // Filter to only columns that exist in both backup and target
      const columns = backupColumns.filter((c) => targetColumns.has(c));

      if (columns.length < backupColumns.length) {
        const missingCols = backupColumns.filter((c) => !targetColumns.has(c));
        console.error(`   ⚠️  ${table}: skipping columns not in target: ${missingCols.join(", ")}`);
      }

      // For project tables, we need to remap project_id and skip the 'id' column
      // to let the database auto-generate new IDs
      const hasProjectId = columns.includes("project_id") && !isGlobal && table !== "projects";
      const isProjectsTable = table === "projects";

      // Skip 'id' column to let database auto-generate (except for projects table which
      // needs to maintain references, and global tables which may have cross-project refs)
      let insertColumns = columns;
      if (!isGlobal && !isProjectsTable) {
        insertColumns = columns.filter((c) => c !== "id");
      }

      // Build INSERT OR IGNORE statement
      const placeholders = insertColumns.map(() => "?").join(", ");
      const columnList = insertColumns.join(", ");
      const insertSql = `INSERT OR IGNORE INTO ${table} (${columnList}) VALUES (${placeholders})`;

      let copied = 0;
      let skipped = 0;

      for (const row of rows) {
        // Remap project_id if this table has it and we're in project mode
        if (hasProjectId && row.project_id !== null) {
          const oldId = row.project_id as number;
          const newId = projectIdMap.get(oldId);
          if (newId === undefined) {
            // No mapping found - skip this row
            skipped++;
            continue;
          }
          row.project_id = newId;
        }

        // Skip projects table entries - they're already in the database
        if (isProjectsTable && !isGlobal) {
          skipped++;
          continue;
        }

        const values = insertColumns.map((col) => row[col] as null | string | number | Uint8Array);
        try {
          // Use direct client to write to primary
          const result = await directClient.execute({ sql: insertSql, args: values });
          if (result.rowsAffected > 0) {
            copied++;
          } else {
            skipped++;
          }
        } catch (_error) {
          // Row might already exist or have constraint issues
          skipped++;
        }
      }

      stats.push({ table, rowsCopied: copied, skipped });
      totalRows += copied;
      totalSkipped += skipped;

      if (copied > 0 || skipped > 0) {
        console.error(`   ✅ ${table}: ${copied} copied, ${skipped} skipped`);
      }
    }
  } finally {
    directClient.close();
    backupDb.close();
  }

  console.error(`\n📊 Migration Summary:`);
  console.error(`   Total rows copied: ${totalRows}`);
  console.error(`   Total rows skipped: ${totalSkipped}`);

  // Sync to primary
  console.error(`\n🔄 Syncing to primary...`);
  try {
    const start = performance.now();
    await adapter.sync();
    const latencyMs = Math.round(performance.now() - start);
    console.error(`✅ Sync complete (${latencyMs}ms)\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`⚠️  Sync failed: ${message}`);
    console.error(`   Data is stored locally and will sync on next interval.\n`);
  }

  outputSuccess({
    migrated: true,
    totalRows,
    totalSkipped,
    tables: stats,
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

    case "migrate": {
      const isGlobal = args.includes("--global");
      const backupPath = args.slice(1).find((a) => !a.startsWith("--"));

      if (!backupPath) {
        console.error("Usage: muninn network migrate <backup-file> [--global]");
        console.error("");
        console.error("Migrate data from a bun:sqlite backup to the network-mode database.");
        console.error("");
        console.error("Arguments:");
        console.error("  <backup-file>       Path to the backup .db file");
        console.error("");
        console.error("Options:");
        console.error("  --global            Migrate to global database instead of project database");
        console.error("");
        console.error("Examples:");
        console.error("  muninn network migrate .claude/memory.db.backup");
        console.error("  muninn network migrate ~/.claude/memory.db.backup --global");
        outputJson({ migrated: false, error: "No backup file specified" });
        return;
      }

      // Get the right adapter (global or project)
      const targetAdapter = isGlobal ? await getGlobalDb() : adapter;
      await networkMigrate(targetAdapter, backupPath, isGlobal);
      break;
    }

    default:
      if (!subCmd || subCmd === "-h" || subCmd === "--help") {
        console.error("Usage: muninn network <status|sync|init|migrate>");
        console.error("");
        console.error("Commands:");
        console.error("  status              Show network connection status");
        console.error("  sync                Force immediate sync to primary");
        console.error("  init [--push]       Initialize network mode, optionally push local data");
        console.error("  migrate <file>      Migrate data from bun:sqlite backup to network DB");
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
