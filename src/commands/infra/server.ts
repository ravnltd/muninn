/**
 * Server management commands
 * Add, list, remove, check servers
 */

import type { Database } from "bun:sqlite";
import type { Server } from "../../types";
import { parseServerArgs, ServerAddInput } from "../../utils/validation";
import { exitWithUsage } from "../../utils/errors";
import { outputJson, outputSuccess, formatServerList, getStatusIcon } from "../../utils/format";
import { getAllServers, getServerByName } from "../../database/queries/infra";
import { logInfraEvent } from "../../database/queries/infra";

// ============================================================================
// Server Add
// ============================================================================

export function serverAdd(db: Database, args: string[]): void {
  const { values } = parseServerArgs(args);

  if (!values.name) {
    exitWithUsage("Usage: context infra server add <name> --ip <ip> [--role production|homelab] [--user root] [--port 22] [--key ~/.ssh/id_ed25519]");
  }

  // Validate and extract values
  const parsed = ServerAddInput.safeParse(values);
  if (!parsed.success) {
    console.error(`❌ Invalid input: ${parsed.error.issues[0].message}`);
    process.exit(1);
  }

  const input = parsed.data;

  // Check if server already exists
  const existing = getServerByName(db, input.name);
  if (existing) {
    console.error(`❌ Server '${input.name}' already exists. Use 'context infra server remove' first.`);
    process.exit(1);
  }

  const ipAddresses = input.ip ? JSON.stringify([input.ip]) : null;
  const tags = input.tags ? JSON.stringify(input.tags.split(',').map(t => t.trim())) : null;

  db.run(`
    INSERT INTO servers (name, hostname, ip_addresses, role, ssh_user, ssh_port, ssh_key_path, ssh_jump_host, os, tags, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown')
  `, [
    input.name,
    input.hostname || null,
    ipAddresses,
    input.role || null,
    input.user,
    input.port,
    input.key || null,
    input.jump || null,
    input.os || null,
    tags,
    input.notes || null,
  ]);

  logInfraEvent(db, {
    eventType: 'server_added',
    severity: 'info',
    title: `Server ${input.name} added`,
    description: `IP: ${input.ip || 'none'}, Role: ${input.role || 'unset'}`,
  });

  console.error(`✅ Server '${input.name}' added`);
  outputSuccess({ name: input.name });
}

// ============================================================================
// Server List
// ============================================================================

export function serverList(db: Database): void {
  const servers = getAllServers(db);
  formatServerList(servers);
  outputJson(servers);
}

// ============================================================================
// Server Remove
// ============================================================================

export function serverRemove(db: Database, name: string | undefined): void {
  if (!name) {
    exitWithUsage("Usage: context infra server remove <name>");
  }

  const server = getServerByName(db, name);
  if (!server) {
    console.error(`❌ Server '${name}' not found`);
    process.exit(1);
  }

  // Get service count for logging
  const serviceCount = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM services WHERE server_id = ?"
  ).get(server.id)?.count || 0;

  db.run("DELETE FROM servers WHERE name = ?", [name]);

  logInfraEvent(db, {
    eventType: 'server_removed',
    severity: 'warning',
    title: `Server ${name} removed`,
    description: serviceCount > 0 ? `${serviceCount} services were also removed` : undefined,
  });

  console.error(`✅ Server '${name}' removed${serviceCount > 0 ? ` (and ${serviceCount} services)` : ''}`);
  outputSuccess({ name, servicesRemoved: serviceCount });
}

// ============================================================================
// Server Check (SSH Connectivity)
// ============================================================================

export async function serverCheck(db: Database, targetName?: string): Promise<void> {
  const servers = targetName
    ? [getServerByName(db, targetName)].filter(Boolean) as Server[]
    : getAllServers(db);

  if (servers.length === 0) {
    console.error(targetName
      ? `❌ Server '${targetName}' not found`
      : "No servers to check. Add one with: context infra server add <name> --ip <ip>");
    outputJson({ checked: 0, online: 0, offline: 0 });
    return;
  }

  console.error("\n🔍 Checking server connectivity...\n");

  const results: Array<{ name: string; status: 'online' | 'offline'; latency?: number; error?: string }> = [];

  for (const server of servers) {
    const startTime = Date.now();

    // Build SSH command
    const sshArgs: string[] = [];

    if (server.ssh_key_path) {
      sshArgs.push("-i", server.ssh_key_path);
    }

    if (server.ssh_jump_host) {
      sshArgs.push("-J", server.ssh_jump_host);
    }

    sshArgs.push(
      "-o", "ConnectTimeout=5",
      "-o", "StrictHostKeyChecking=no",
      "-o", "BatchMode=yes",
      "-p", String(server.ssh_port),
      `${server.ssh_user}@${server.ip_addresses ? JSON.parse(server.ip_addresses)[0] : server.hostname}`,
      "echo ok"
    );

    try {
      const result = Bun.spawnSync(["ssh", ...sshArgs]);
      const latency = Date.now() - startTime;

      if (result.exitCode === 0) {
        console.error(`  ${getStatusIcon('online')} ${server.name} - online (${latency}ms)`);
        results.push({ name: server.name, status: 'online', latency });

        // Update server status in DB
        db.run(`
          UPDATE servers SET status = 'online', last_seen = CURRENT_TIMESTAMP, last_health_check = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [server.id]);
      } else {
        const errorOutput = result.stderr.toString().trim();
        console.error(`  ${getStatusIcon('offline')} ${server.name} - offline`);
        if (errorOutput) {
          console.error(`     ${errorOutput.substring(0, 100)}`);
        }
        results.push({ name: server.name, status: 'offline', error: errorOutput });

        db.run(`
          UPDATE servers SET status = 'offline', last_health_check = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [server.id]);

        logInfraEvent(db, {
          serverId: server.id,
          eventType: 'server_check_failed',
          severity: 'error',
          title: `Server ${server.name} check failed`,
          description: errorOutput || 'SSH connection failed',
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  ${getStatusIcon('offline')} ${server.name} - error: ${errorMessage}`);
      results.push({ name: server.name, status: 'offline', error: errorMessage });
    }
  }

  console.error("");

  const online = results.filter(r => r.status === 'online').length;
  const offline = results.filter(r => r.status === 'offline').length;

  console.error(`Summary: ${online}/${results.length} servers online`);
  if (offline > 0) {
    console.error(`⚠️  ${offline} server(s) offline - check connectivity`);
  }

  outputJson({ checked: results.length, online, offline, results });
}
