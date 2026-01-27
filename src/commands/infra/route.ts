/**
 * Route management commands
 * Add, list, remove routes (domain -> service mappings)
 */

import type { DatabaseAdapter } from "../../database/adapter";
import { getAllRoutes, getServiceByName, logInfraEvent } from "../../database/queries/infra";
import { exitWithUsage } from "../../utils/errors";
import { outputJson, outputSuccess } from "../../utils/format";
import { parseRouteArgs, RouteAddInput } from "../../utils/validation";

// ============================================================================
// Route Add
// ============================================================================

export async function routeAdd(db: DatabaseAdapter, args: string[]): Promise<void> {
  const { values } = parseRouteArgs(args);

  if (!values.domain || !values.service) {
    exitWithUsage("Usage: context infra route add <domain> --service <service> [--path /] [--ssl letsencrypt]");
  }

  const parsed = RouteAddInput.safeParse(values);
  if (!parsed.success) {
    console.error(`❌ Invalid input: ${parsed.error.issues[0].message}`);
    process.exit(1);
  }

  const input = parsed.data;

  // Verify service exists
  const service = await getServiceByName(db, input.service);
  if (!service) {
    console.error(`❌ Service '${input.service}' not found. Add it first with: context infra service add`);
    process.exit(1);
  }

  // Check if route already exists
  const existing = await db.get<{ id: number }>("SELECT id FROM routes WHERE domain = ? AND path = ?", [input.domain, input.path]);

  if (existing) {
    console.error(`❌ Route for ${input.domain}${input.path} already exists`);
    process.exit(1);
  }

  await db.run(
    `
    INSERT INTO routes (domain, path, service_id, proxy_type, ssl_type, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    [input.domain, input.path, service.id, input.proxy || null, input.ssl || null, input.notes || null]
  );

  await logInfraEvent(db, {
    serviceId: service.id,
    eventType: "route_added",
    severity: "info",
    title: `Route ${input.domain}${input.path} → ${input.service}`,
    description: input.ssl ? `SSL: ${input.ssl}` : undefined,
  });

  console.error(`✅ Route added: ${input.domain}${input.path} → ${input.service}`);
  outputSuccess({ domain: input.domain, path: input.path, service: input.service });
}

// ============================================================================
// Route List
// ============================================================================

export async function routeList(db: DatabaseAdapter): Promise<void> {
  const routes = await getAllRoutes(db);

  if (routes.length === 0) {
    console.error("No routes registered. Add one with: context infra route add <domain> --service <service>");
    outputJson([]);
    return;
  }

  console.error("\n🌐 Registered Routes:\n");

  for (const route of routes) {
    const ssl = route.ssl_type ? ` [${route.ssl_type}]` : "";
    const path = route.path !== "/" ? route.path : "";
    console.error(`  ${route.domain}${path}${ssl}`);
    console.error(`     → ${route.service_name} @ ${route.server_name}`);
  }

  console.error("");
  outputJson(routes);
}

// ============================================================================
// Route Remove
// ============================================================================

export async function routeRemove(db: DatabaseAdapter, domain: string | undefined): Promise<void> {
  if (!domain) {
    exitWithUsage("Usage: context infra route remove <domain>");
  }

  const route = await db.get<{ id: number; domain: string; path: string; service_id: number }>(
    "SELECT id, domain, path, service_id FROM routes WHERE domain = ?",
    [domain]
  );

  if (!route) {
    console.error(`❌ Route for '${domain}' not found`);
    process.exit(1);
  }

  await db.run("DELETE FROM routes WHERE id = ?", [route.id]);

  await logInfraEvent(db, {
    serviceId: route.service_id,
    eventType: "route_removed",
    severity: "warning",
    title: `Route ${route.domain}${route.path} removed`,
  });

  console.error(`✅ Route '${domain}' removed`);
  outputSuccess({ domain });
}

// ============================================================================
// Route Check (DNS and Connectivity)
// ============================================================================

export async function routeCheck(db: DatabaseAdapter, domain?: string): Promise<void> {
  const routes = domain
    ? await db.all<{ domain: string; path: string; service_id: number }>(
        "SELECT domain, path, service_id FROM routes WHERE domain = ?",
        [domain]
      )
    : await getAllRoutes(db);

  if (routes.length === 0) {
    console.error(domain ? `❌ No routes found for domain '${domain}'` : "No routes to check");
    outputJson({ checked: 0, reachable: 0, unreachable: 0 });
    return;
  }

  console.error("\n🔍 Checking route connectivity...\n");

  const results: Array<{ domain: string; path: string; status: "ok" | "error"; httpCode?: string; error?: string }> =
    [];

  for (const route of routes) {
    const url = `https://${route.domain}${route.path}`;

    try {
      const startTime = Date.now();
      const result = Bun.spawnSync(["curl", "-sf", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", url]);

      const latency = Date.now() - startTime;
      const httpCode = result.stdout.toString().trim();

      if ((result.exitCode === 0 && httpCode.startsWith("2")) || httpCode.startsWith("3")) {
        console.error(`  🟢 ${route.domain}${route.path} - HTTP ${httpCode} (${latency}ms)`);
        results.push({ domain: route.domain, path: route.path, status: "ok", httpCode });
      } else {
        console.error(`  🔴 ${route.domain}${route.path} - HTTP ${httpCode || "failed"}`);
        results.push({ domain: route.domain, path: route.path, status: "error", httpCode: httpCode || "timeout" });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`  🔴 ${route.domain}${route.path} - ${errorMessage}`);
      results.push({ domain: route.domain, path: route.path, status: "error", error: errorMessage });
    }
  }

  console.error("");

  const reachable = results.filter((r) => r.status === "ok").length;
  const unreachable = results.filter((r) => r.status === "error").length;

  console.error(`Summary: ${reachable}/${results.length} routes reachable`);
  if (unreachable > 0) {
    console.error(`⚠️  ${unreachable} route(s) unreachable`);
  }

  outputJson({ checked: results.length, reachable, unreachable, results });
}
