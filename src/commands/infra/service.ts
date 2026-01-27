/**
 * Service management commands
 * Add, list, remove, status for services
 */

import type { DatabaseAdapter } from "../../database/adapter";
import {
  getAllServicesWithServerName,
  getServerByName,
  getServiceByName,
  getServiceByNameAndServer,
  logInfraEvent,
} from "../../database/queries/infra";
import type { Service } from "../../types";
import { exitWithUsage } from "../../utils/errors";
import { getStatusIcon, outputJson, outputSuccess } from "../../utils/format";
import { parseServiceArgs, ServiceAddInput } from "../../utils/validation";

// ============================================================================
// Service Add
// ============================================================================

export async function serviceAdd(db: DatabaseAdapter, args: string[]): Promise<void> {
  const { values } = parseServiceArgs(args);

  if (!values.name || !values.server) {
    exitWithUsage(
      "Usage: context infra service add <name> --server <server> [--port 3000] [--type app|database|cache]"
    );
  }

  const parsed = ServiceAddInput.safeParse(values);
  if (!parsed.success) {
    console.error(`❌ Invalid input: ${parsed.error.issues[0].message}`);
    process.exit(1);
  }

  const input = parsed.data;

  // Verify server exists
  const server = await getServerByName(db, input.server);
  if (!server) {
    console.error(`❌ Server '${input.server}' not found. Add it first with: context infra server add`);
    process.exit(1);
  }

  // Check if service already exists on this server
  const existing = await getServiceByNameAndServer(db, input.name, server.id);
  if (existing) {
    console.error(`❌ Service '${input.name}' already exists on server '${input.server}'`);
    process.exit(1);
  }

  await db.run(
    `
    INSERT INTO services (
      name, server_id, type, runtime, port, health_endpoint,
      project_path, git_repo, git_branch,
      deploy_command, restart_command, stop_command, log_command, env_file
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      input.name,
      server.id,
      input.type || null,
      input.runtime || null,
      input.port || null,
      input.health || null,
      input.project || null,
      input.repo || null,
      input.branch,
      input.deploy || null,
      input.restart || null,
      input.stop || null,
      input.logs || null,
      input.env || null,
    ]
  );

  await logInfraEvent(db, {
    serverId: server.id,
    eventType: "service_added",
    severity: "info",
    title: `Service ${input.name} added to ${input.server}`,
    description: input.port ? `Port: ${input.port}` : undefined,
  });

  console.error(`✅ Service '${input.name}' added to server '${input.server}'`);
  outputSuccess({ name: input.name, server: input.server });
}

// ============================================================================
// Service List
// ============================================================================

export async function serviceList(db: DatabaseAdapter, serverFilter?: string): Promise<void> {
  const services = await getAllServicesWithServerName(db, serverFilter);

  if (services.length === 0) {
    console.error(
      serverFilter
        ? `No services found on server '${serverFilter}'`
        : "No services registered. Add one with: context infra service add <name> --server <server>"
    );
    outputJson([]);
    return;
  }

  console.error("\n📦 Registered Services:\n");

  let currentServer = "";
  for (const svc of services) {
    if (svc.server_name !== currentServer) {
      if (currentServer) console.error("");
      console.error(`  📡 ${svc.server_name}`);
      currentServer = svc.server_name;
    }

    const healthIcon = getStatusIcon(svc.health_status);
    const port = svc.port ? `:${svc.port}` : "";
    const type = svc.type ? ` (${svc.type})` : "";

    console.error(`     ${healthIcon} ${svc.name}${port}${type}`);
    if (svc.git_repo) {
      console.error(`        Git: ${svc.git_repo}@${svc.git_branch}`);
    }
  }

  console.error("");
  outputJson(services);
}

// ============================================================================
// Service Remove
// ============================================================================

export async function serviceRemove(db: DatabaseAdapter, name: string | undefined, serverFilter?: string): Promise<void> {
  if (!name) {
    exitWithUsage("Usage: context infra service remove <name> [--server <server>]");
  }

  let service: Service | null = null;
  let serverName = serverFilter;

  if (serverFilter) {
    const server = await getServerByName(db, serverFilter);
    if (!server) {
      console.error(`❌ Server '${serverFilter}' not found`);
      process.exit(1);
    }
    service = await getServiceByNameAndServer(db, name, server.id);
  } else {
    service = await getServiceByName(db, name);
    if (service) {
      // Get server name for logging
      const server = await db.get<{ name: string }>("SELECT name FROM servers WHERE id = ?", [service.server_id]);
      serverName = server?.name;
    }
  }

  if (!service) {
    console.error(`❌ Service '${name}' not found${serverFilter ? ` on server '${serverFilter}'` : ""}`);
    process.exit(1);
  }

  // Get route count for logging
  const routeCountResult = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM routes WHERE service_id = ?", [service.id]);
  const routeCount = routeCountResult?.count || 0;

  await db.run("DELETE FROM services WHERE id = ?", [service.id]);

  await logInfraEvent(db, {
    eventType: "service_removed",
    severity: "warning",
    title: `Service ${name} removed from ${serverName || "unknown"}`,
    description: routeCount > 0 ? `${routeCount} routes were also removed` : undefined,
  });

  console.error(`✅ Service '${name}' removed${routeCount > 0 ? ` (and ${routeCount} routes)` : ""}`);
  outputSuccess({ name, server: serverName, routesRemoved: routeCount });
}

// ============================================================================
// Service Status (via SSH)
// ============================================================================

export async function serviceStatus(db: DatabaseAdapter, serviceName: string): Promise<void> {
  const service = await getServiceByName(db, serviceName);
  if (!service) {
    console.error(`❌ Service '${serviceName}' not found`);
    process.exit(1);
  }

  const server = await db.get<{
    name: string;
    ssh_user: string;
    ssh_port: number;
    ssh_key_path: string | null;
    ip_addresses: string | null;
    hostname: string | null;
  }>("SELECT name, ssh_user, ssh_port, ssh_key_path, ip_addresses, hostname FROM servers WHERE id = ?", [service.server_id]);

  if (!server) {
    console.error(`❌ Server not found for service '${serviceName}'`);
    process.exit(1);
  }

  console.error(`\n📦 Service Status: ${serviceName}@${server.name}\n`);

  // Build SSH command
  const sshTarget = server.ip_addresses ? JSON.parse(server.ip_addresses)[0] : server.hostname;
  const sshArgs: string[] = [];

  if (server.ssh_key_path) {
    sshArgs.push("-i", server.ssh_key_path);
  }

  sshArgs.push(
    "-o",
    "ConnectTimeout=5",
    "-o",
    "StrictHostKeyChecking=no",
    "-p",
    String(server.ssh_port),
    `${server.ssh_user}@${sshTarget}`
  );

  // Try to get service status via systemctl or docker
  const statusCommands = [
    `systemctl status ${serviceName} 2>/dev/null | head -15`,
    `docker ps --filter name=${serviceName} --format '{{.Status}}' 2>/dev/null`,
    `pm2 show ${serviceName} 2>/dev/null | head -10`,
  ];

  for (const cmd of statusCommands) {
    const result = Bun.spawnSync(["ssh", ...sshArgs, cmd]);
    if (result.exitCode === 0 && result.stdout.toString().trim()) {
      console.error(result.stdout.toString());
      break;
    }
  }

  // If health endpoint is configured, check it
  if (service.health_endpoint) {
    console.error("\n🏥 Health Check:");
    const healthUrl = service.port
      ? `http://localhost:${service.port}${service.health_endpoint}`
      : service.health_endpoint;

    const curlCmd = `curl -sf -o /dev/null -w '%{http_code}' ${healthUrl}`;
    const result = Bun.spawnSync(["ssh", ...sshArgs, curlCmd]);

    if (result.exitCode === 0) {
      const httpCode = result.stdout.toString().trim();
      const healthy = httpCode === "200" || httpCode === "204";
      console.error(`  ${healthy ? "🟢" : "🔴"} ${healthUrl} - HTTP ${httpCode}`);

      // Update health status
      await db.run(
        `
        UPDATE services SET health_status = ?, last_health_check = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        [healthy ? "healthy" : "unhealthy", service.id]
      );
    } else {
      console.error(`  🔴 ${healthUrl} - unreachable`);
      await db.run(
        `
        UPDATE services SET health_status = 'unhealthy', last_health_check = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        [service.id]
      );
    }
  }

  console.error("");
  outputJson({ service: serviceName, server: server.name });
}

// ============================================================================
// Service Logs (via SSH)
// ============================================================================

export async function serviceLogs(db: DatabaseAdapter, serviceName: string, lines: number = 50): Promise<void> {
  const service = await getServiceByName(db, serviceName);
  if (!service) {
    console.error(`❌ Service '${serviceName}' not found`);
    process.exit(1);
  }

  const server = await db.get<{
    name: string;
    ssh_user: string;
    ssh_port: number;
    ssh_key_path: string | null;
    ip_addresses: string | null;
    hostname: string | null;
  }>("SELECT name, ssh_user, ssh_port, ssh_key_path, ip_addresses, hostname FROM servers WHERE id = ?", [service.server_id]);

  if (!server) {
    console.error(`❌ Server not found for service '${serviceName}'`);
    process.exit(1);
  }

  // Build SSH command
  const sshTarget = server.ip_addresses ? JSON.parse(server.ip_addresses)[0] : server.hostname;
  const sshArgs: string[] = [];

  if (server.ssh_key_path) {
    sshArgs.push("-i", server.ssh_key_path);
  }

  sshArgs.push(
    "-o",
    "ConnectTimeout=5",
    "-o",
    "StrictHostKeyChecking=no",
    "-p",
    String(server.ssh_port),
    `${server.ssh_user}@${sshTarget}`
  );

  // Use custom log command if available, otherwise try common patterns
  const logCmd =
    service.log_command ||
    `journalctl -u ${serviceName} -n ${lines} --no-pager 2>/dev/null || docker logs --tail ${lines} ${serviceName} 2>/dev/null || tail -n ${lines} /var/log/${serviceName}.log 2>/dev/null`;

  console.error(`📋 Logs for ${serviceName}@${server.name}:\n`);

  const result = Bun.spawnSync(["ssh", ...sshArgs, logCmd], {
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    console.error(`\n❌ Could not retrieve logs. Try setting a custom log command.`);
  }
}
