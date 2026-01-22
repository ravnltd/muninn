/**
 * Infrastructure queries
 * Optimized queries for server/service/route management
 * Fixes N+1 query issues by using JOINs and batching
 *
 * Includes both raw SQL (legacy) and Drizzle ORM (new) versions
 */

import type { Database } from "bun:sqlite";
import { eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { servers, services, routes, infraEvents } from "../schema";
import type {
  Server,
  Service,
  Route,
  ServiceWithDomain,
  RouteWithService,
  ServerWithServices,
  InfraStatus,
  InfraEventWithNames,
} from "../../types";
import { logError } from "../../utils/errors";

// ============================================================================
// Drizzle ORM Queries (Type-Safe)
// ============================================================================

export const drizzleInfra = {
  /** Get all servers ordered by name */
  getAllServers(db: DrizzleDb) {
    return db.select().from(servers).orderBy(servers.name);
  },

  /** Get server by name */
  getServerByName(db: DrizzleDb, name: string) {
    return db.select().from(servers).where(eq(servers.name, name)).get();
  },

  /** Get server by ID */
  getServerById(db: DrizzleDb, id: number) {
    return db.select().from(servers).where(eq(servers.id, id)).get();
  },

  /** Get service by name */
  getServiceByName(db: DrizzleDb, name: string) {
    return db.select().from(services).where(eq(services.name, name)).get();
  },

  /** Get services by server ID */
  getServicesByServerId(db: DrizzleDb, serverId: number) {
    return db.select().from(services).where(eq(services.serverId, serverId)).orderBy(services.name);
  },

  /** Get all routes with service info */
  getAllRoutes(db: DrizzleDb) {
    return db
      .select({
        id: routes.id,
        domain: routes.domain,
        path: routes.path,
        serviceId: routes.serviceId,
        method: routes.method,
        proxyType: routes.proxyType,
        sslType: routes.sslType,
        rateLimit: routes.rateLimit,
        authRequired: routes.authRequired,
        notes: routes.notes,
        createdAt: routes.createdAt,
        serviceName: services.name,
        serverName: servers.name,
      })
      .from(routes)
      .innerJoin(services, eq(routes.serviceId, services.id))
      .innerJoin(servers, eq(services.serverId, servers.id))
      .orderBy(routes.domain, routes.path);
  },

  /** Log an infrastructure event */
  logEvent(
    db: DrizzleDb,
    params: {
      serverId?: number;
      serviceId?: number;
      eventType: string;
      severity: "info" | "warning" | "error" | "critical";
      title: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    return db.insert(infraEvents).values({
      serverId: params.serverId ?? null,
      serviceId: params.serviceId ?? null,
      eventType: params.eventType,
      severity: params.severity,
      title: params.title,
      description: params.description ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    });
  },
};

// ============================================================================
// Server Queries
// ============================================================================

export function getAllServers(db: Database): Server[] {
  return db.query<Server, []>(`
    SELECT * FROM servers ORDER BY name
  `).all();
}

export function getServerByName(db: Database, name: string): Server | null {
  return db.query<Server, [string]>(`
    SELECT * FROM servers WHERE name = ?
  `).get(name) ?? null;
}

export function getServerById(db: Database, id: number): Server | null {
  return db.query<Server, [number]>(`
    SELECT * FROM servers WHERE id = ?
  `).get(id) ?? null;
}

// ============================================================================
// Service Queries
// ============================================================================

export function getServicesByServerId(db: Database, serverId: number): ServiceWithDomain[] {
  return db.query<ServiceWithDomain, [number]>(`
    SELECT sv.*,
      (SELECT domain FROM routes WHERE service_id = sv.id LIMIT 1) as primary_domain
    FROM services sv
    WHERE sv.server_id = ?
    ORDER BY sv.name
  `).all(serverId);
}

export function getServiceByName(db: Database, name: string): Service | null {
  return db.query<Service, [string]>(`
    SELECT * FROM services WHERE name = ?
  `).get(name) ?? null;
}

export function getServiceByNameAndServer(db: Database, name: string, serverId: number): Service | null {
  return db.query<Service, [string, number]>(`
    SELECT * FROM services WHERE name = ? AND server_id = ?
  `).get(name, serverId) ?? null;
}

export function getAllServicesWithServerName(db: Database, serverFilter?: string): Array<Service & { server_name: string }> {
  if (serverFilter) {
    return db.query<Service & { server_name: string }, [string]>(`
      SELECT sv.*, s.name as server_name
      FROM services sv
      JOIN servers s ON sv.server_id = s.id
      WHERE s.name = ?
      ORDER BY sv.name
    `).all(serverFilter);
  }

  return db.query<Service & { server_name: string }, []>(`
    SELECT sv.*, s.name as server_name
    FROM services sv
    JOIN servers s ON sv.server_id = s.id
    ORDER BY s.name, sv.name
  `).all();
}

// ============================================================================
// Route Queries
// ============================================================================

export function getAllRoutes(db: Database): RouteWithService[] {
  return db.query<RouteWithService, []>(`
    SELECT r.*, sv.name as service_name, s.name as server_name
    FROM routes r
    JOIN services sv ON r.service_id = sv.id
    JOIN servers s ON sv.server_id = s.id
    ORDER BY r.domain, r.path
  `).all();
}

export function getRoutesByServiceId(db: Database, serviceId: number): Route[] {
  return db.query<Route, [number]>(`
    SELECT * FROM routes WHERE service_id = ?
  `).all(serviceId);
}

// ============================================================================
// Infrastructure Status (Optimized - Single Query)
// ============================================================================

interface InfraStatusRow {
  server_id: number;
  server_name: string;
  server_hostname: string | null;
  server_ip_addresses: string | null;
  server_role: string | null;
  server_status: string;
  server_ssh_user: string;
  server_ssh_port: number;
  server_ssh_key_path: string | null;
  server_ssh_jump_host: string | null;
  server_os: string | null;
  server_resources: string | null;
  server_tags: string | null;
  server_last_seen: string | null;
  server_notes: string | null;
  server_created_at: string;
  server_updated_at: string;
  service_id: number | null;
  service_name: string | null;
  service_type: string | null;
  service_runtime: string | null;
  service_port: number | null;
  service_health_status: string | null;
  service_status: string | null;
  service_current_version: string | null;
  primary_domain: string | null;
}

/**
 * Get full infrastructure status in a single query (fixes N+1)
 */
export function getInfraStatus(db: Database): InfraStatus {
  const rows = db.query<InfraStatusRow, []>(`
    SELECT
      s.id as server_id,
      s.name as server_name,
      s.hostname as server_hostname,
      s.ip_addresses as server_ip_addresses,
      s.role as server_role,
      s.status as server_status,
      s.ssh_user as server_ssh_user,
      s.ssh_port as server_ssh_port,
      s.ssh_key_path as server_ssh_key_path,
      s.ssh_jump_host as server_ssh_jump_host,
      s.os as server_os,
      s.resources as server_resources,
      s.tags as server_tags,
      s.last_seen as server_last_seen,
      s.notes as server_notes,
      s.created_at as server_created_at,
      s.updated_at as server_updated_at,
      sv.id as service_id,
      sv.name as service_name,
      sv.type as service_type,
      sv.runtime as service_runtime,
      sv.port as service_port,
      sv.health_status as service_health_status,
      sv.status as service_status,
      sv.current_version as service_current_version,
      (SELECT domain FROM routes WHERE service_id = sv.id LIMIT 1) as primary_domain
    FROM servers s
    LEFT JOIN services sv ON sv.server_id = s.id
    ORDER BY s.name, sv.name
  `).all();

  // Group by server in memory (O(n) instead of N+1 queries)
  const serverMap = new Map<number, ServerWithServices>();
  let serversOnline = 0;
  let totalServices = 0;
  let servicesHealthy = 0;

  for (const row of rows) {
    if (!serverMap.has(row.server_id)) {
      const server: ServerWithServices = {
        id: row.server_id,
        name: row.server_name,
        hostname: row.server_hostname,
        ip_addresses: row.server_ip_addresses,
        role: row.server_role as Server['role'],
        ssh_user: row.server_ssh_user,
        ssh_port: row.server_ssh_port,
        ssh_key_path: row.server_ssh_key_path,
        ssh_jump_host: row.server_ssh_jump_host,
        os: row.server_os,
        resources: row.server_resources,
        tags: row.server_tags,
        status: row.server_status as Server['status'],
        last_seen: row.server_last_seen,
        last_health_check: null,
        notes: row.server_notes,
        created_at: row.server_created_at,
        updated_at: row.server_updated_at,
        services: [],
      };
      serverMap.set(row.server_id, server);

      if (server.status === 'online') {
        serversOnline++;
      }
    }

    if (row.service_id !== null) {
      const service: ServiceWithDomain = {
        id: row.service_id,
        name: row.service_name!,
        server_id: row.server_id,
        type: row.service_type,
        runtime: row.service_runtime,
        port: row.service_port,
        health_endpoint: null,
        health_status: (row.service_health_status || 'unknown') as Service['health_status'],
        last_health_check: null,
        response_time_ms: null,
        config: null,
        env_file: null,
        project_path: null,
        git_repo: null,
        git_branch: 'main',
        current_version: row.service_current_version,
        deploy_command: null,
        restart_command: null,
        stop_command: null,
        log_command: null,
        status: (row.service_status || 'unknown') as Service['status'],
        auto_restart: 1,
        created_at: '',
        updated_at: '',
        primary_domain: row.primary_domain ?? undefined,
      };

      serverMap.get(row.server_id)!.services.push(service);
      totalServices++;

      if (service.health_status === 'healthy') {
        servicesHealthy++;
      }
    }
  }

  return {
    servers: Array.from(serverMap.values()),
    summary: {
      total_servers: serverMap.size,
      servers_online: serversOnline,
      total_services: totalServices,
      services_healthy: servicesHealthy,
    },
  };
}

// ============================================================================
// Dependency Queries
// ============================================================================

export function getServiceDependencies(db: Database, serviceId: number): Array<{
  depends_on: string;
  location: string;
  dependency_type: string | null;
  required: number;
}> {
  return db.query<{
    depends_on: string;
    location: string;
    dependency_type: string | null;
    required: number;
  }, [number]>(`
    SELECT
      COALESCE(s2.name, sd.depends_on_external) as depends_on,
      CASE WHEN s2.id IS NOT NULL THEN srv.name ELSE 'external' END as location,
      sd.dependency_type,
      sd.required
    FROM service_deps sd
    LEFT JOIN services s2 ON sd.depends_on_service_id = s2.id
    LEFT JOIN servers srv ON s2.server_id = srv.id
    WHERE sd.service_id = ?
  `).all(serviceId);
}

export function getServiceDependents(db: Database, serviceId: number): Array<{
  service_name: string;
  server_name: string;
  dependency_type: string | null;
}> {
  return db.query<{
    service_name: string;
    server_name: string;
    dependency_type: string | null;
  }, [number]>(`
    SELECT s1.name as service_name, srv.name as server_name, sd.dependency_type
    FROM service_deps sd
    JOIN services s1 ON sd.service_id = s1.id
    JOIN servers srv ON s1.server_id = srv.id
    WHERE sd.depends_on_service_id = ?
  `).all(serviceId);
}

export function getAllDependencies(db: Database): Array<{
  service_name: string;
  server_name: string;
  depends_on: string;
  depends_on_location: string;
  dependency_type: string | null;
}> {
  return db.query<{
    service_name: string;
    server_name: string;
    depends_on: string;
    depends_on_location: string;
    dependency_type: string | null;
  }, []>(`
    SELECT
      s1.name as service_name,
      srv1.name as server_name,
      COALESCE(s2.name, sd.depends_on_external) as depends_on,
      CASE WHEN s2.id IS NOT NULL THEN srv2.name ELSE 'external' END as depends_on_location,
      sd.dependency_type
    FROM service_deps sd
    JOIN services s1 ON sd.service_id = s1.id
    JOIN servers srv1 ON s1.server_id = srv1.id
    LEFT JOIN services s2 ON sd.depends_on_service_id = s2.id
    LEFT JOIN servers srv2 ON s2.server_id = srv2.id
    ORDER BY s1.name
  `).all();
}

// ============================================================================
// Event Queries
// ============================================================================

export function getRecentEvents(db: Database, limit: number = 20): InfraEventWithNames[] {
  return db.query<InfraEventWithNames, [number]>(`
    SELECT e.*, s.name as server_name, sv.name as service_name
    FROM infra_events e
    LEFT JOIN servers s ON e.server_id = s.id
    LEFT JOIN services sv ON e.service_id = sv.id
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function logInfraEvent(
  db: Database,
  params: {
    serverId?: number;
    serviceId?: number;
    eventType: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    title: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }
): void {
  try {
    db.run(`
      INSERT INTO infra_events (server_id, service_id, event_type, severity, title, description, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      params.serverId ?? null,
      params.serviceId ?? null,
      params.eventType,
      params.severity,
      params.title,
      params.description ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]);
  } catch (error) {
    logError('logInfraEvent', error);
  }
}

// ============================================================================
// Map Data for Visualization
// ============================================================================

export function getMapData(db: Database): {
  servers: ServerWithServices[];
  deps: Array<{ from_svc: string; to_svc: string | null; dependency_type: string | null }>;
  routes: Array<{ domain: string; service_name: string }>;
} {
  const status = getInfraStatus(db);

  const deps = db.query<{
    from_svc: string;
    to_svc: string | null;
    dependency_type: string | null;
  }, []>(`
    SELECT s1.name as from_svc, s2.name as to_svc, sd.dependency_type
    FROM service_deps sd
    JOIN services s1 ON sd.service_id = s1.id
    LEFT JOIN services s2 ON sd.depends_on_service_id = s2.id
  `).all();

  const routes = db.query<{
    domain: string;
    service_name: string;
  }, []>(`
    SELECT r.domain, sv.name as service_name
    FROM routes r
    JOIN services sv ON r.service_id = sv.id
  `).all();

  return {
    servers: status.servers,
    deps,
    routes,
  };
}
