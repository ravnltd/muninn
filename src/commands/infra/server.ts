/**
 * Server management commands
 * Add, list, remove, check servers
 */

import type { DatabaseAdapter } from "../../database/adapter";
import { homedir } from "node:os";
import { resolve, normalize } from "node:path";
import { getAllServers, getServerByName, logInfraEvent } from "../../database/queries/infra";
import type { Server } from "../../types";
import { exitWithUsage } from "../../utils/errors";
import { formatServerList, getStatusIcon, outputJson, outputSuccess } from "../../utils/format";
import { parseServerArgs, ServerAddInput } from "../../utils/validation";

// ============================================================================
// SSH Security Validation (H1, H2)
// ============================================================================

/**
 * Pattern for valid SSH jump host format.
 * Allows: user@host, host, user@host:port, host:port
 * Also allows multiple hops separated by commas
 * Rejects: anything with shell metacharacters or options
 */
const VALID_JUMP_HOST_PATTERN = /^([a-zA-Z0-9_.-]+@)?[a-zA-Z0-9.-]+(:\d+)?(,([a-zA-Z0-9_.-]+@)?[a-zA-Z0-9.-]+(:\d+)?)*$/;

/**
 * Characters that should never appear in SSH arguments.
 * These could be used for option injection.
 */
const SSH_DANGEROUS_CHARS = /[`$(){}|;&<>\\'"!]/;

/**
 * Validate SSH key path is within allowed directories (H1).
 * Prevents arbitrary file access via SSH -i option.
 *
 * Allowed locations:
 * - ~/.ssh/
 * - /etc/ssh/ (for host keys)
 * - Current working directory (for project-specific keys)
 *
 * @throws Error if path is outside allowed directories
 */
function validateSshKeyPath(keyPath: string): string {
  const normalizedPath = normalize(resolve(keyPath));
  const home = homedir();
  const allowedPrefixes = [
    resolve(home, ".ssh") + "/",
    "/etc/ssh/",
    process.cwd() + "/",
  ];

  const isAllowed = allowedPrefixes.some((prefix) => normalizedPath.startsWith(prefix));

  if (!isAllowed) {
    throw new Error(
      `SSH key path must be within ~/.ssh/, /etc/ssh/, or current directory. Got: ${keyPath}`
    );
  }

  // Additional check: no shell metacharacters
  if (SSH_DANGEROUS_CHARS.test(keyPath)) {
    throw new Error(`SSH key path contains invalid characters: ${keyPath}`);
  }

  return normalizedPath;
}

/**
 * Validate SSH jump host format (H2).
 * Prevents command injection via -J option.
 *
 * Valid formats:
 * - hostname
 * - user@hostname
 * - user@hostname:port
 * - Multiple hops: user@host1,user@host2
 *
 * @throws Error if jump host format is invalid
 */
function validateSshJumpHost(jumpHost: string): string {
  // Check for dangerous characters first
  if (SSH_DANGEROUS_CHARS.test(jumpHost)) {
    throw new Error(`SSH jump host contains invalid characters: ${jumpHost}`);
  }

  // Validate format
  if (!VALID_JUMP_HOST_PATTERN.test(jumpHost)) {
    throw new Error(
      `Invalid SSH jump host format. Expected: [user@]host[:port]. Got: ${jumpHost}`
    );
  }

  // Check individual components aren't too long (prevent buffer issues)
  const parts = jumpHost.split(",");
  for (const part of parts) {
    if (part.length > 253) {
      // Max DNS name length
      throw new Error(`SSH jump host component too long: ${part.substring(0, 50)}...`);
    }
  }

  return jumpHost;
}

// ============================================================================
// Server Add
// ============================================================================

export async function serverAdd(db: DatabaseAdapter, args: string[]): Promise<void> {
  const { values } = parseServerArgs(args);

  if (!values.name) {
    exitWithUsage(
      "Usage: context infra server add <name> --ip <ip> [--role production|homelab] [--user root] [--port 22] [--key ~/.ssh/id_ed25519]"
    );
  }

  // Validate and extract values
  const parsed = ServerAddInput.safeParse(values);
  if (!parsed.success) {
    console.error(`❌ Invalid input: ${parsed.error.issues[0].message}`);
    process.exit(1);
  }

  const input = parsed.data;

  // Security validation for SSH key path (H1)
  if (input.key) {
    try {
      validateSshKeyPath(input.key);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Invalid SSH key path";
      console.error(`❌ ${msg}`);
      process.exit(1);
    }
  }

  // Security validation for SSH jump host (H2)
  if (input.jump) {
    try {
      validateSshJumpHost(input.jump);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Invalid SSH jump host";
      console.error(`❌ ${msg}`);
      process.exit(1);
    }
  }

  // Check if server already exists
  const existing = await getServerByName(db, input.name);
  if (existing) {
    console.error(`❌ Server '${input.name}' already exists. Use 'muninn infra server remove' first.`);
    process.exit(1);
  }

  const ipAddresses = input.ip ? JSON.stringify([input.ip]) : null;
  const tags = input.tags ? JSON.stringify(input.tags.split(",").map((t) => t.trim())) : null;

  await db.run(
    `
    INSERT INTO servers (name, hostname, ip_addresses, role, ssh_user, ssh_port, ssh_key_path, ssh_jump_host, os, tags, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown')
  `,
    [
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
    ]
  );

  await logInfraEvent(db, {
    eventType: "server_added",
    severity: "info",
    title: `Server ${input.name} added`,
    description: `IP: ${input.ip || "none"}, Role: ${input.role || "unset"}`,
  });

  console.error(`✅ Server '${input.name}' added`);
  outputSuccess({ name: input.name });
}

// ============================================================================
// Server List
// ============================================================================

export async function serverList(db: DatabaseAdapter): Promise<void> {
  const servers = await getAllServers(db);
  formatServerList(servers);
  outputJson(servers);
}

// ============================================================================
// Server Remove
// ============================================================================

export async function serverRemove(db: DatabaseAdapter, name: string | undefined): Promise<void> {
  if (!name) {
    exitWithUsage("Usage: context infra server remove <name>");
  }

  const server = await getServerByName(db, name);
  if (!server) {
    console.error(`❌ Server '${name}' not found`);
    process.exit(1);
  }

  // Get service count for logging
  const serviceCountResult = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM services WHERE server_id = ?", [server.id]);
  const serviceCount = serviceCountResult?.count || 0;

  await db.run("DELETE FROM servers WHERE name = ?", [name]);

  await logInfraEvent(db, {
    eventType: "server_removed",
    severity: "warning",
    title: `Server ${name} removed`,
    description: serviceCount > 0 ? `${serviceCount} services were also removed` : undefined,
  });

  console.error(`✅ Server '${name}' removed${serviceCount > 0 ? ` (and ${serviceCount} services)` : ""}`);
  outputSuccess({ name, servicesRemoved: serviceCount });
}

// ============================================================================
// Server Check (SSH Connectivity)
// ============================================================================

export async function serverCheck(db: DatabaseAdapter, targetName?: string): Promise<void> {
  const servers = targetName ? ([await getServerByName(db, targetName)].filter(Boolean) as Server[]) : await getAllServers(db);

  if (servers.length === 0) {
    console.error(
      targetName
        ? `❌ Server '${targetName}' not found`
        : "No servers to check. Add one with: context infra server add <name> --ip <ip>"
    );
    outputJson({ checked: 0, online: 0, offline: 0 });
    return;
  }

  console.error("\n🔍 Checking server connectivity...\n");

  const results: Array<{ name: string; status: "online" | "offline"; latency?: number; error?: string }> = [];

  for (const server of servers) {
    const startTime = Date.now();

    // Build SSH command with security validation (H1, H2)
    const sshArgs: string[] = [];

    if (server.ssh_key_path) {
      try {
        const validatedKeyPath = validateSshKeyPath(server.ssh_key_path);
        sshArgs.push("-i", validatedKeyPath);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Invalid key path";
        console.error(`  ⚠️  ${server.name} - skipped: ${errorMessage}`);
        results.push({ name: server.name, status: "offline", error: errorMessage });
        continue;
      }
    }

    if (server.ssh_jump_host) {
      try {
        const validatedJumpHost = validateSshJumpHost(server.ssh_jump_host);
        sshArgs.push("-J", validatedJumpHost);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Invalid jump host";
        console.error(`  ⚠️  ${server.name} - skipped: ${errorMessage}`);
        results.push({ name: server.name, status: "offline", error: errorMessage });
        continue;
      }
    }

    // Validate target host doesn't contain dangerous characters
    const targetHost = server.ip_addresses ? JSON.parse(server.ip_addresses)[0] : server.hostname;
    if (!targetHost || SSH_DANGEROUS_CHARS.test(targetHost) || SSH_DANGEROUS_CHARS.test(server.ssh_user)) {
      const errorMessage = "Invalid target host or user format";
      console.error(`  ⚠️  ${server.name} - skipped: ${errorMessage}`);
      results.push({ name: server.name, status: "offline", error: errorMessage });
      continue;
    }

    sshArgs.push(
      "-o",
      "ConnectTimeout=5",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "BatchMode=yes",
      "-p",
      String(server.ssh_port),
      `${server.ssh_user}@${targetHost}`,
      "echo ok"
    );

    try {
      const result = Bun.spawnSync(["ssh", ...sshArgs]);
      const latency = Date.now() - startTime;

      if (result.exitCode === 0) {
        console.error(`  ${getStatusIcon("online")} ${server.name} - online (${latency}ms)`);
        results.push({ name: server.name, status: "online", latency });

        // Update server status in DB
        await db.run(
          `
          UPDATE servers SET status = 'online', last_seen = CURRENT_TIMESTAMP, last_health_check = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
          [server.id]
        );
      } else {
        const errorOutput = result.stderr.toString().trim();
        console.error(`  ${getStatusIcon("offline")} ${server.name} - offline`);
        if (errorOutput) {
          console.error(`     ${errorOutput.substring(0, 100)}`);
        }
        results.push({ name: server.name, status: "offline", error: errorOutput });

        await db.run(
          `
          UPDATE servers SET status = 'offline', last_health_check = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
          [server.id]
        );

        await logInfraEvent(db, {
          serverId: server.id,
          eventType: "server_check_failed",
          severity: "error",
          title: `Server ${server.name} check failed`,
          description: errorOutput || "SSH connection failed",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`  ${getStatusIcon("offline")} ${server.name} - error: ${errorMessage}`);
      results.push({ name: server.name, status: "offline", error: errorMessage });
    }
  }

  console.error("");

  const online = results.filter((r) => r.status === "online").length;
  const offline = results.filter((r) => r.status === "offline").length;

  console.error(`Summary: ${online}/${results.length} servers online`);
  if (offline > 0) {
    console.error(`⚠️  ${offline} server(s) offline - check connectivity`);
  }

  outputJson({ checked: results.length, online, offline, results });
}
