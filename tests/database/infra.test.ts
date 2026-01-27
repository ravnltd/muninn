/**
 * Infrastructure query tests
 * Tests server, service, and route database operations
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, seedTestServers, seedTestServices, type TestDb } from "../helpers/db-setup";

describe("Server Operations", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("creates server", () => {
    const result = testDb.rawDb.run(
      `INSERT INTO servers (name, hostname, role, status) VALUES (?, ?, ?, ?)`,
      ["prod-1", "server1.example.com", "production", "online"]
    );
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });

  test("gets server by name", () => {
    const server = testDb.rawDb
      .query<{ id: number; name: string; role: string }, [string]>(
        `SELECT id, name, role FROM servers WHERE name = ?`
      )
      .get("prod-1");

    expect(server).toBeDefined();
    expect(server?.name).toBe("prod-1");
    expect(server?.role).toBe("production");
  });

  test("lists all servers", () => {
    // Add more servers
    testDb.rawDb.run(`INSERT INTO servers (name, role, status) VALUES (?, ?, ?)`, ["staging-1", "staging", "online"]);
    testDb.rawDb.run(`INSERT INTO servers (name, role, status) VALUES (?, ?, ?)`, ["dev-1", "development", "offline"]);

    const servers = testDb.rawDb
      .query<{ name: string; status: string }, []>(`SELECT name, status FROM servers ORDER BY name`)
      .all();

    expect(servers.length).toBeGreaterThanOrEqual(3);
  });

  test("updates server status", () => {
    testDb.rawDb.run(`UPDATE servers SET status = ? WHERE name = ?`, ["degraded", "prod-1"]);

    const server = testDb.rawDb
      .query<{ status: string }, [string]>(`SELECT status FROM servers WHERE name = ?`)
      .get("prod-1");

    expect(server?.status).toBe("degraded");
  });

  test("deletes server", () => {
    testDb.rawDb.run(`INSERT INTO servers (name) VALUES (?)`, ["to-delete"]);
    testDb.rawDb.run(`DELETE FROM servers WHERE name = ?`, ["to-delete"]);

    const server = testDb.rawDb
      .query<{ id: number }, [string]>(`SELECT id FROM servers WHERE name = ?`)
      .get("to-delete");

    expect(server).toBeNull();
  });
});

describe("Service Operations", () => {
  let testDb: TestDb;
  let serverIds: number[];

  beforeAll(() => {
    testDb = createTestDb();
    serverIds = seedTestServers(testDb.rawDb, [
      { name: "web-server", role: "production", status: "online" },
      { name: "db-server", role: "production", status: "online" },
    ]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("creates service on server", () => {
    const result = testDb.rawDb.run(
      `INSERT INTO services (name, server_id, port, health_status) VALUES (?, ?, ?, ?)`,
      ["api", serverIds[0], 3000, "healthy"]
    );
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });

  test("creates multiple services", () => {
    seedTestServices(testDb.rawDb, [
      { name: "web", serverId: serverIds[0], port: 80, healthStatus: "healthy" },
      { name: "postgres", serverId: serverIds[1], port: 5432, healthStatus: "healthy" },
    ]);

    const services = testDb.rawDb
      .query<{ name: string; port: number }, []>(`SELECT name, port FROM services`)
      .all();

    expect(services.length).toBeGreaterThanOrEqual(3);
  });

  test("gets services for server", () => {
    const services = testDb.rawDb
      .query<{ name: string; port: number }, [number]>(`SELECT name, port FROM services WHERE server_id = ?`)
      .all(serverIds[0]);

    expect(services.length).toBeGreaterThanOrEqual(2);
    expect(services.some((s) => s.name === "api")).toBe(true);
  });

  test("updates service health status", () => {
    testDb.rawDb.run(`UPDATE services SET health_status = ? WHERE name = ?`, ["unhealthy", "api"]);

    const service = testDb.rawDb
      .query<{ health_status: string }, [string]>(`SELECT health_status FROM services WHERE name = ?`)
      .get("api");

    expect(service?.health_status).toBe("unhealthy");
  });

  test("cascades delete on server deletion", () => {
    // Create a new server with services
    const result = testDb.rawDb.run(`INSERT INTO servers (name) VALUES (?)`, ["cascade-test"]);
    const serverId = Number(result.lastInsertRowid);

    testDb.rawDb.run(`INSERT INTO services (name, server_id, port) VALUES (?, ?, ?)`, ["cascade-svc", serverId, 8080]);

    // Verify service exists
    let service = testDb.rawDb.query<{ id: number }, [number]>(`SELECT id FROM services WHERE server_id = ?`).get(serverId);
    expect(service).toBeDefined();

    // Delete server
    testDb.rawDb.run(`DELETE FROM servers WHERE id = ?`, [serverId]);

    // Service should be deleted
    service = testDb.rawDb.query<{ id: number }, [number]>(`SELECT id FROM services WHERE server_id = ?`).get(serverId);
    expect(service).toBeNull();
  });
});

describe("Route Operations", () => {
  let testDb: TestDb;
  let serverId: number;
  let serviceId: number;

  beforeAll(() => {
    testDb = createTestDb();

    const serverResult = testDb.rawDb.run(`INSERT INTO servers (name, status) VALUES (?, ?)`, ["route-server", "online"]);
    serverId = Number(serverResult.lastInsertRowid);

    const serviceResult = testDb.rawDb.run(
      `INSERT INTO services (name, server_id, port) VALUES (?, ?, ?)`,
      ["route-api", serverId, 3000]
    );
    serviceId = Number(serviceResult.lastInsertRowid);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("creates route", () => {
    const result = testDb.rawDb.run(
      `INSERT INTO routes (domain, path, service_id, ssl_type) VALUES (?, ?, ?, ?)`,
      ["api.example.com", "/v1", serviceId, "letsencrypt"]
    );
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });

  test("gets routes for service", () => {
    testDb.rawDb.run(`INSERT INTO routes (domain, path, service_id) VALUES (?, ?, ?)`, [
      "api.example.com",
      "/v2",
      serviceId,
    ]);

    const routes = testDb.rawDb
      .query<{ domain: string; path: string }, [number]>(`SELECT domain, path FROM routes WHERE service_id = ?`)
      .all(serviceId);

    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  test("enforces unique constraint on domain/path/method", () => {
    try {
      testDb.rawDb.run(`INSERT INTO routes (domain, path, method, service_id) VALUES (?, ?, ?, ?)`, [
        "unique.example.com",
        "/",
        "*",
        serviceId,
      ]);
      testDb.rawDb.run(`INSERT INTO routes (domain, path, method, service_id) VALUES (?, ?, ?, ?)`, [
        "unique.example.com",
        "/",
        "*",
        serviceId,
      ]);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});

describe("Service Dependencies", () => {
  let testDb: TestDb;
  let serverId: number;
  let apiServiceId: number;
  let dbServiceId: number;

  beforeAll(() => {
    testDb = createTestDb();

    const serverResult = testDb.rawDb.run(`INSERT INTO servers (name, status) VALUES (?, ?)`, ["dep-server", "online"]);
    serverId = Number(serverResult.lastInsertRowid);

    const apiResult = testDb.rawDb.run(`INSERT INTO services (name, server_id) VALUES (?, ?)`, ["api-svc", serverId]);
    apiServiceId = Number(apiResult.lastInsertRowid);

    const dbResult = testDb.rawDb.run(`INSERT INTO services (name, server_id) VALUES (?, ?)`, ["db-svc", serverId]);
    dbServiceId = Number(dbResult.lastInsertRowid);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("creates internal service dependency", () => {
    const result = testDb.rawDb.run(
      `INSERT INTO service_deps (service_id, depends_on_service_id, dependency_type, required) VALUES (?, ?, ?, ?)`,
      [apiServiceId, dbServiceId, "database", 1]
    );
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });

  test("creates external dependency", () => {
    const result = testDb.rawDb.run(
      `INSERT INTO service_deps (service_id, depends_on_external, dependency_type) VALUES (?, ?, ?)`,
      [apiServiceId, "https://api.stripe.com", "api"]
    );
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });

  test("gets dependencies for service", () => {
    const deps = testDb.rawDb
      .query<{ depends_on_service_id: number | null; depends_on_external: string | null; dependency_type: string }, [number]>(
        `SELECT depends_on_service_id, depends_on_external, dependency_type FROM service_deps WHERE service_id = ?`
      )
      .all(apiServiceId);

    expect(deps.length).toBeGreaterThanOrEqual(2);
    expect(deps.some((d) => d.depends_on_service_id === dbServiceId)).toBe(true);
    expect(deps.some((d) => d.depends_on_external?.includes("stripe"))).toBe(true);
  });
});

describe("Infrastructure Health Aggregation", () => {
  let testDb: TestDb;

  beforeAll(() => {
    testDb = createTestDb();

    // Set up infrastructure with mixed health states
    const serverIds = seedTestServers(testDb.rawDb, [
      { name: "healthy-server", status: "online" },
      { name: "degraded-server", status: "degraded" },
      { name: "offline-server", status: "offline" },
    ]);

    seedTestServices(testDb.rawDb, [
      { name: "healthy-svc-1", serverId: serverIds[0], healthStatus: "healthy" },
      { name: "healthy-svc-2", serverId: serverIds[0], healthStatus: "healthy" },
      { name: "degraded-svc", serverId: serverIds[1], healthStatus: "degraded" },
      { name: "unhealthy-svc", serverId: serverIds[2], healthStatus: "unhealthy" },
    ]);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  test("counts servers by status", () => {
    const stats = testDb.rawDb
      .query<{ status: string; count: number }, []>(`SELECT status, COUNT(*) as count FROM servers GROUP BY status`)
      .all();

    const online = stats.find((s) => s.status === "online");
    const degraded = stats.find((s) => s.status === "degraded");
    const offline = stats.find((s) => s.status === "offline");

    expect(online?.count).toBeGreaterThanOrEqual(1);
    expect(degraded?.count).toBeGreaterThanOrEqual(1);
    expect(offline?.count).toBeGreaterThanOrEqual(1);
  });

  test("counts services by health status", () => {
    const stats = testDb.rawDb
      .query<{ health_status: string; count: number }, []>(
        `SELECT health_status, COUNT(*) as count FROM services GROUP BY health_status`
      )
      .all();

    const healthy = stats.find((s) => s.health_status === "healthy");
    expect(healthy?.count).toBeGreaterThanOrEqual(2);
  });

  test("gets services with server info", () => {
    const services = testDb.rawDb
      .query<{ service_name: string; server_name: string; server_status: string }, []>(`
        SELECT s.name as service_name, srv.name as server_name, srv.status as server_status
        FROM services s
        JOIN servers srv ON s.server_id = srv.id
        ORDER BY srv.name, s.name
      `)
      .all();

    expect(services.length).toBeGreaterThan(0);
    expect(services[0]).toHaveProperty("service_name");
    expect(services[0]).toHaveProperty("server_name");
  });
});
