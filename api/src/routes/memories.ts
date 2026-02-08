/**
 * Memory CRUD Routes
 *
 * POST   /v1/memories       — Create a memory
 * GET    /v1/memories/:id   — Get a memory
 * PATCH  /v1/memories/:id   — Update a memory
 * DELETE /v1/memories/:id   — Soft-delete a memory
 * POST   /v1/memories/batch — Batch operations
 */

import { Hono } from "hono";
import type { ApiEnv } from "../types";
import {
  MemoryInputSchema,
  MemoryUpdateSchema,
  BatchOperationSchema,
} from "../types";
import {
  createMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  batchOperations,
} from "../services/memory-store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const memories = new Hono<ApiEnv>();

// POST /v1/memories — Create a memory
memories.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = MemoryInputSchema.safeParse(body);
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
    const result = await createMemory(tenantId, appId, parsed.data);
    return c.json(
      {
        ...result.memory,
        embedding_status: result.embedding_status,
      },
      201
    );
  } catch (error) {
    console.error("[memories] Create failed:", error);
    return c.json({ error: "Failed to create memory" }, 500);
  }
});

// GET /v1/memories/:id — Get a memory
memories.get("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const memoryId = c.req.param("id");
  if (!UUID_RE.test(memoryId)) {
    return c.json({ error: "Invalid memory ID format" }, 400);
  }

  try {
    const memory = await getMemory(tenantId, memoryId);
    if (!memory) {
      return c.json({ error: "Memory not found" }, 404);
    }
    return c.json(memory);
  } catch (error) {
    console.error("[memories] Get failed:", error);
    return c.json({ error: "Failed to retrieve memory" }, 500);
  }
});

// PATCH /v1/memories/:id — Update a memory
memories.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = MemoryUpdateSchema.safeParse(body);
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
  const memoryId = c.req.param("id");
  if (!UUID_RE.test(memoryId)) {
    return c.json({ error: "Invalid memory ID format" }, 400);
  }

  try {
    const updated = await updateMemory(tenantId, memoryId, parsed.data);
    if (!updated) {
      return c.json({ error: "Memory not found" }, 404);
    }
    return c.json(updated);
  } catch (error) {
    console.error("[memories] Update failed:", error);
    return c.json({ error: "Failed to update memory" }, 500);
  }
});

// DELETE /v1/memories/:id — Soft-delete a memory
memories.delete("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const memoryId = c.req.param("id");
  if (!UUID_RE.test(memoryId)) {
    return c.json({ error: "Invalid memory ID format" }, 400);
  }

  try {
    const deleted = await deleteMemory(tenantId, memoryId);
    if (!deleted) {
      return c.json({ error: "Memory not found" }, 404);
    }
    return c.body(null, 204);
  } catch (error) {
    console.error("[memories] Delete failed:", error);
    return c.json({ error: "Failed to delete memory" }, 500);
  }
});

// POST /v1/memories/batch — Batch operations
memories.post("/batch", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = BatchOperationSchema.safeParse(body);
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
    const results = await batchOperations(tenantId, appId, parsed.data.operations);
    return c.json({ results });
  } catch (error) {
    console.error("[memories] Batch failed:", error);
    return c.json({ error: "Batch operation failed" }, 500);
  }
});

export { memories };
