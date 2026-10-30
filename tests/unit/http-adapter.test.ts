import { afterEach, describe, expect, test } from "bun:test";
import { HttpAdapter } from "../../src/database/adapters/http";

type Body = { requests: Array<{ type: string; batch?: { steps: Array<{ stmt: { sql: string }; condition?: unknown }> } }> };

const realFetch = globalThis.fetch;
let bodies: Body[] = [];

function mockHub(stepErrors: Array<{ message: string } | null> = []) {
  bodies = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Body;
    bodies.push(body);
    const results = body.requests.map((r) =>
      r.type === "batch"
        ? { type: "ok", response: { type: "batch", result: { step_results: [], step_errors: stepErrors } } }
        : { type: "ok", response: { type: r.type, result: { cols: [], rows: [], affected_row_count: 0 } } },
    );
    return new Response(JSON.stringify({ baton: null, results }));
  }) as typeof fetch;
}

async function adapter(): Promise<HttpAdapter> {
  const a = new HttpAdapter({ primaryUrl: "http://hub.test" });
  await a.init();
  return a;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("HttpAdapter hrana streams", () => {
  test("every pipeline ends with close so sqld frees the connection", async () => {
    mockHub();
    const a = await adapter();
    await a.run("INSERT INTO t VALUES (?)", [1]);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b.requests.at(-1)?.type).toBe("close");
  });

  test("batch COMMIT is conditional on every prior step succeeding", async () => {
    mockHub();
    const a = await adapter();
    await a.batch([{ sql: "INSERT INTO t VALUES (1)" }, { sql: "INSERT INTO t VALUES (2)" }]);
    const steps = bodies.at(-1)?.requests[0].batch?.steps ?? [];
    expect(steps.at(-1)?.stmt.sql).toBe("COMMIT");
    expect(steps.at(-1)?.condition).toEqual({
      type: "and",
      conds: [0, 1, 2].map((step) => ({ type: "ok", step })),
    });
  });

  test("batch throws when a step fails instead of reporting success", async () => {
    mockHub([null, { message: "no such table: t" }, null, null]);
    const a = await adapter();
    await expect(a.batch([{ sql: "INSERT INTO t VALUES (1)" }, { sql: "INSERT INTO t VALUES (2)" }])).rejects.toThrow(
      "no such table: t",
    );
  });
});
