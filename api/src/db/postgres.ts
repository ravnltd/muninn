/**
 * PostgreSQL Connection Module
 *
 * Uses the `postgres` npm package (porsager/postgres) for connection pooling.
 * Provides a singleton connection with lazy initialization.
 */

import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;

/**
 * Get the shared Postgres connection pool.
 * Creates one on first call using DATABASE_URL env var.
 */
export function getDb(): ReturnType<typeof postgres> {
  if (sql) return sql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  sql = postgres(url, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
    transform: {
      undefined: null,
    },
  });

  return sql;
}

/**
 * Close the database connection pool.
 * Call during graceful shutdown.
 */
export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
  }
}

/**
 * Check database connectivity.
 * Returns true if a simple query succeeds.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const db = getDb();
    await db`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
