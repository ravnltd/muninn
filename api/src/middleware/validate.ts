/**
 * Zod Request Validation Middleware
 *
 * Validates JSON request body against a Zod schema.
 * Returns 400 with structured error on validation failure.
 */

import type { Context, Next } from "hono";
import type { z } from "zod";

/**
 * Create validation middleware for a Zod schema.
 * Parses request body and attaches validated data to a custom header.
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      return c.json({ error: "Validation failed", details: errors }, 400);
    }

    // Store validated body for route handler access
    c.set("validatedBody", result.data);
    return next();
  };
}
