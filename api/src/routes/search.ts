/**
 * Search Route
 *
 * POST /v1/memories/search — Hybrid search across memories
 */

import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { SearchRequestSchema } from "../types";
import { searchMemories } from "../services/memory-search";

const search = new Hono<ApiEnv>();

search.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = SearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400
    );
  }

  const tenantId = c.get("tenantId");
  const appId = c.get("appId");

  try {
    const result = await searchMemories(tenantId, appId, parsed.data);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[search] Search failed:", error);
    return c.json({ error: message }, 500);
  }
});

export { search };
