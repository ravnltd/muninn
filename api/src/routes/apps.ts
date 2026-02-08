/**
 * App Management Routes
 *
 * GET    /v1/apps              — List registered apps
 * POST   /v1/apps              — Register an app
 * GET    /v1/apps/:id/types    — List types for an app
 * POST   /v1/apps/:id/types    — Register a custom type
 * PUT    /v1/apps/:id/grants   — Set cross-app permissions
 */

import { Hono } from "hono";
import { getDb } from "../db/postgres";
import type { ApiEnv } from "../types";
import { AppInputSchema, AppTypeInputSchema, GrantInputSchema } from "../types";

const apps = new Hono<ApiEnv>();

// GET /v1/apps — List registered apps for this tenant
apps.get("/", async (c) => {
  const db = getDb();
  const tenantId = c.get("tenantId");

  try {
    const rows = await db`
      SELECT id, tenant_id, name, description, created_at::text
      FROM apps
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at
    `;
    return c.json({ apps: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

// POST /v1/apps — Register an app
apps.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = AppInputSchema.safeParse(body);
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

  const db = getDb();
  const tenantId = c.get("tenantId");

  try {
    // Ensure tenant exists
    await db`
      INSERT INTO tenants (id, name)
      VALUES (${tenantId}, ${tenantId})
      ON CONFLICT (id) DO NOTHING
    `;

    const rows = await db`
      INSERT INTO apps (id, tenant_id, name, description)
      VALUES (${parsed.data.id}, ${tenantId}, ${parsed.data.name}, ${parsed.data.description ?? null})
      ON CONFLICT (tenant_id, id) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description
      RETURNING id, tenant_id, name, description, created_at::text
    `;

    return c.json(rows[0], 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[apps] Register failed:", error);
    return c.json({ error: message }, 500);
  }
});

// GET /v1/apps/:id/types — List types for an app
apps.get("/:id/types", async (c) => {
  const db = getDb();
  const tenantId = c.get("tenantId");
  const appId = c.req.param("id");

  try {
    const rows = await db`
      SELECT id, app_id, base_type, schema, description, created_at::text
      FROM app_types
      WHERE tenant_id = ${tenantId} AND app_id = ${appId}
      ORDER BY id
    `;
    return c.json({ types: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

// POST /v1/apps/:id/types — Register a custom type
apps.post("/:id/types", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = AppTypeInputSchema.safeParse(body);
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

  const db = getDb();
  const tenantId = c.get("tenantId");
  const appId = c.req.param("id");

  try {
    const rows = await db`
      INSERT INTO app_types (id, app_id, tenant_id, base_type, schema, description)
      VALUES (
        ${parsed.data.id}, ${appId}, ${tenantId},
        ${parsed.data.base_type},
        ${parsed.data.schema ? JSON.stringify(parsed.data.schema) : null}::jsonb,
        ${parsed.data.description ?? null}
      )
      ON CONFLICT (tenant_id, app_id, id) DO UPDATE
        SET base_type = EXCLUDED.base_type,
            schema = EXCLUDED.schema,
            description = EXCLUDED.description
      RETURNING id, app_id, base_type, schema, description, created_at::text
    `;

    return c.json(rows[0], 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[apps] Register type failed:", error);
    return c.json({ error: message }, 500);
  }
});

// PUT /v1/apps/:id/grants — Set cross-app read permissions
apps.put("/:id/grants", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = GrantInputSchema.safeParse(body);
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

  const db = getDb();
  const tenantId = c.get("tenantId");
  const grantingApp = c.req.param("id");

  try {
    // Verify the granting app belongs to this tenant
    const appCheck = await db`
      SELECT id FROM apps WHERE tenant_id = ${tenantId} AND id = ${grantingApp}
    `;
    if (appCheck.length === 0) {
      return c.json({ error: "App not found" }, 404);
    }

    const rows = await db`
      INSERT INTO app_grants (tenant_id, granting_app, granted_app, permission, scopes)
      VALUES (
        ${tenantId}, ${grantingApp}, ${parsed.data.granted_app},
        ${parsed.data.permission ?? "read"}, ${parsed.data.scopes ?? []}
      )
      ON CONFLICT (tenant_id, granting_app, granted_app) DO UPDATE
        SET permission = EXCLUDED.permission,
            scopes = EXCLUDED.scopes
      RETURNING tenant_id, granting_app, granted_app, permission, scopes, created_at::text
    `;

    return c.json(rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[apps] Grant failed:", error);
    return c.json({ error: message }, 500);
  }
});

export { apps };
