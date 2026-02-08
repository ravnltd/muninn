/**
 * Health Check Routes
 */

import { Hono } from "hono";
import { checkHealth, getDb } from "../db/postgres";

const health = new Hono();

health.get("/health", async (c) => {
  const dbHealthy = await checkHealth();

  const status = dbHealthy ? "ok" : "degraded";
  const code = dbHealthy ? 200 : 503;

  return c.json(
    {
      status,
      version: "0.1.0",
      service: "muninn-memory-api",
      checks: {
        database: dbHealthy ? "connected" : "unreachable",
      },
    },
    code
  );
});

health.get("/stats", async (c) => {
  const db = getDb();

  try {
    const [memoryCount] = await db`
      SELECT count(*) AS total FROM memories WHERE deleted_at IS NULL
    `;
    const [embeddingCount] = await db`
      SELECT count(*) AS total FROM memories WHERE deleted_at IS NULL AND embedding IS NOT NULL
    `;
    const [appCount] = await db`
      SELECT count(*) AS total FROM apps
    `;

    return c.json({
      memories: {
        total: Number(memoryCount.total),
        with_embeddings: Number(embeddingCount.total),
      },
      apps: Number(appCount.total),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

export { health };
