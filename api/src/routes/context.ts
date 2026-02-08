/**
 * Context Route
 *
 * POST /v1/memories/context — Get Claude-ready context block
 */

import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { ContextRequestSchema } from "../types";
import { buildContext } from "../services/context-builder";

const context = new Hono<ApiEnv>();

context.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = ContextRequestSchema.safeParse(body);
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
    const result = await buildContext(tenantId, appId, parsed.data);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[context] Context build failed:", error);
    return c.json({ error: message }, 500);
  }
});

export { context };
