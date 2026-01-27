/**
 * Infrastructure status and visualization commands
 * Status overview, map visualization, events log
 */

import type { DatabaseAdapter } from "../../database/adapter";
import { parseArgs } from "node:util";
import {
  getAllDependencies,
  getInfraStatus,
  getMapData,
  getRecentEvents,
  getServiceByName,
  getServiceDependencies,
  getServiceDependents,
} from "../../database/queries/infra";
import { exitWithUsage } from "../../utils/errors";
import {
  formatInfraStatus,
  generateAsciiInfraMap,
  generateMermaidInfraMap,
  getSeverityIcon,
  getTimeAgo,
  outputJson,
} from "../../utils/format";

// ============================================================================
// Infrastructure Status
// ============================================================================

export async function infraStatus(db: DatabaseAdapter): Promise<void> {
  const status = await getInfraStatus(db);
  formatInfraStatus(status);
  outputJson(status);
}

// ============================================================================
// Infrastructure Map
// ============================================================================

export async function infraMap(db: DatabaseAdapter, format: "ascii" | "mermaid" = "ascii"): Promise<void> {
  const mapData = await getMapData(db);

  if (mapData.servers.length === 0) {
    console.error("No infrastructure to map.");
    outputJson({ format, diagram: "" });
    return;
  }

  if (format === "mermaid") {
    const mermaid = generateMermaidInfraMap(mapData.servers, mapData.deps, mapData.routes);
    console.error(mermaid);
    outputJson({ format: "mermaid", diagram: mermaid });
  } else {
    generateAsciiInfraMap(mapData.servers);
    outputJson({ format: "ascii", servers: mapData.servers });
  }
}

// ============================================================================
// Dependency Management
// ============================================================================

export async function depAdd(db: DatabaseAdapter, args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      depends: { type: "string", short: "d" },
      external: { type: "string", short: "e" },
      type: { type: "string", short: "t" },
      env: { type: "string" },
      optional: { type: "boolean" },
    },
    allowPositionals: true,
  });

  const serviceName = positionals[0];
  if (!serviceName || (!values.depends && !values.external)) {
    exitWithUsage(
      "Usage: context infra dep add <service> --depends <other-service> [--type database|cache|api]\n   or: context infra dep add <service> --external stripe [--type api]"
    );
  }

  const service = await getServiceByName(db, serviceName);
  if (!service) {
    console.error(`❌ Service '${serviceName}' not found`);
    process.exit(1);
  }

  let dependsOnId: number | null = null;
  if (values.depends) {
    const depService = await getServiceByName(db, values.depends);
    if (!depService) {
      console.error(`❌ Service '${values.depends}' not found`);
      process.exit(1);
    }
    dependsOnId = depService.id;
  }

  await db.run(
    `
    INSERT INTO service_deps (service_id, depends_on_service_id, depends_on_external, dependency_type, connection_env_var, required)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    [service.id, dependsOnId, values.external || null, values.type || null, values.env || null, values.optional ? 0 : 1]
  );

  const target = values.depends || values.external;
  console.error(`✅ ${serviceName} → ${target} dependency added`);
  outputJson({ success: true, service: serviceName, depends_on: target });
}

export async function depsList(db: DatabaseAdapter, serviceName?: string): Promise<void> {
  if (serviceName) {
    // Show deps for specific service
    const service = await getServiceByName(db, serviceName);
    if (!service) {
      console.error(`❌ Service '${serviceName}' not found`);
      process.exit(1);
    }

    const deps = await getServiceDependencies(db, service.id);
    const reverseDeps = await getServiceDependents(db, service.id);

    console.error(`\n📦 ${serviceName} Dependencies:\n`);

    if (deps.length > 0) {
      console.error("  Depends on:");
      for (const d of deps) {
        const req = d.required ? "required" : "optional";
        console.error(`    → ${d.depends_on} (${d.location}) [${d.dependency_type || "unknown"}, ${req}]`);
      }
    } else {
      console.error("  No dependencies");
    }

    if (reverseDeps.length > 0) {
      console.error("\n  Depended on by:");
      for (const d of reverseDeps) {
        console.error(`    ← ${d.service_name} (${d.server_name})`);
      }
    }

    console.error("");
    outputJson({ service: serviceName, dependencies: deps, dependents: reverseDeps });
  } else {
    // Show all deps
    const allDeps = await getAllDependencies(db);

    console.error("\n📦 Service Dependencies:\n");
    for (const d of allDeps) {
      console.error(`  ${d.service_name} (${d.server_name}) → ${d.depends_on} (${d.depends_on_location})`);
    }
    if (allDeps.length === 0) {
      console.error("  No dependencies registered");
    }
    console.error("");

    outputJson(allDeps);
  }
}

// ============================================================================
// Events Log
// ============================================================================

export async function infraEvents(db: DatabaseAdapter, limit: number = 20): Promise<void> {
  const events = await getRecentEvents(db, limit);

  console.error("\n📋 Recent Infrastructure Events:\n");

  for (const e of events) {
    const severityIcon = getSeverityIcon(e.severity);
    const target = e.service_name ? `${e.service_name}@${e.server_name}` : e.server_name || "system";
    const time = getTimeAgo(e.created_at);

    console.error(`  ${severityIcon} [${time}] ${e.title}`);
    console.error(`     ${target} | ${e.event_type}`);
    if (e.description) {
      console.error(`     ${e.description}`);
    }
  }

  if (events.length === 0) {
    console.error("  No events recorded");
  }
  console.error("");

  outputJson(events);
}

// ============================================================================
// Infrastructure Handler
// ============================================================================

import { routeAdd, routeCheck, routeList, routeRemove } from "./route";
import { serverAdd, serverCheck, serverList, serverRemove } from "./server";
import { serviceAdd, serviceList, serviceLogs, serviceRemove, serviceStatus } from "./service";

export async function handleInfraCommand(db: DatabaseAdapter, args: string[]): Promise<void> {
  const subCmd = args[0];
  const subSubCmd = args[1];
  const restArgs = args.slice(2);

  switch (subCmd) {
    case "server":
      switch (subSubCmd) {
        case "add":
          await serverAdd(db, restArgs);
          break;
        case "list":
        case "ls":
          await serverList(db);
          break;
        case "remove":
        case "rm":
          await serverRemove(db, restArgs[0]);
          break;
        case "check":
        case "ping":
          await serverCheck(db, restArgs[0]);
          break;
        default:
          console.error("Usage: context infra server <add|list|remove|check> [args]");
      }
      break;

    case "service":
    case "svc":
      switch (subSubCmd) {
        case "add":
          await serviceAdd(db, restArgs);
          break;
        case "list":
        case "ls":
          await serviceList(db, restArgs.includes("--server") ? restArgs[restArgs.indexOf("--server") + 1] : undefined);
          break;
        case "remove":
        case "rm":
          await serviceRemove(
            db,
            restArgs[0],
            restArgs.includes("--server") ? restArgs[restArgs.indexOf("--server") + 1] : undefined
          );
          break;
        case "status":
          await serviceStatus(db, restArgs[0]);
          break;
        case "logs":
          await serviceLogs(db, restArgs[0], parseInt(restArgs[restArgs.indexOf("--lines") + 1] || "50", 10));
          break;
        default:
          console.error("Usage: context infra service <add|list|remove|status|logs> [args]");
      }
      break;

    case "route":
      switch (subSubCmd) {
        case "add":
          await routeAdd(db, restArgs);
          break;
        case "list":
        case "ls":
          await routeList(db);
          break;
        case "remove":
        case "rm":
          await routeRemove(db, restArgs[0]);
          break;
        case "check":
          await routeCheck(db, restArgs[0]);
          break;
        default:
          console.error("Usage: context infra route <add|list|remove|check> [args]");
      }
      break;

    case "dep":
    case "deps":
      if (subSubCmd === "add") {
        await depAdd(db, restArgs);
      } else {
        // Show deps, optionally for a specific service
        await depsList(db, subSubCmd && subSubCmd !== "list" ? subSubCmd : undefined);
      }
      break;

    case "status":
    case "st":
      await infraStatus(db);
      break;

    case "map": {
      const format = args.includes("--mermaid") ? "mermaid" : "ascii";
      await infraMap(db, format);
      break;
    }

    case "events":
    case "log": {
      const limitIdx = args.indexOf("--limit");
      const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 20;
      await infraEvents(db, limit);
      break;
    }

    case "check":
      await serverCheck(db);
      break;

    default:
      console.error(`
🏗️  Infrastructure Commands:

  context infra server add <name> --ip <ip> [--role production|homelab] [--user root] [--key ~/.ssh/id_ed25519]
  context infra server list
  context infra server check [name]         Check SSH connectivity
  context infra server remove <name>

  context infra service add <name> --server <server> [--port 3000] [--type app|database|cache]
  context infra service list [--server <name>]
  context infra service remove <name>
  context infra service status <name>
  context infra service logs <name>

  context infra route add <domain> --service <service> [--ssl letsencrypt]
  context infra route list
  context infra route check [domain]

  context infra dep add <service> --depends <other> [--type database|cache|api]
  context infra deps [service]              Show dependencies

  context infra status                      Full infrastructure overview
  context infra map [--mermaid]             Visual topology
  context infra events [--limit 20]         Recent events
  context infra check                       Check all servers
`);
  }
}
