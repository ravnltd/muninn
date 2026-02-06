/**
 * Shared types for Muninn Cloud
 *
 * Re-exports from muninn core to avoid path issues when importing
 * from the parent package.
 */

// Re-export core types
export type { DatabaseAdapter, QueryResult } from "../../src/database/adapter";
export type { HttpAdapterConfig } from "../../src/database/adapters/http";
export { HttpAdapter } from "../../src/database/adapters/http";
