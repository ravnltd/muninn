/**
 * Memory API Types and Zod Validation Schemas
 */

import { z } from "zod";

// ============================================================================
// Core Types
// ============================================================================

export const MEMORY_TYPES = [
  "fact",
  "preference",
  "decision",
  "event",
  "entity",
  "procedure",
  "observation",
] as const;

export const MEMORY_SOURCES = [
  "user",
  "extracted",
  "inferred",
  "imported",
  "system",
] as const;

export const CONTEXT_FORMATS = ["xml", "markdown", "native", "json"] as const;

export const CONTEXT_STRATEGIES = ["balanced", "precise", "broad"] as const;

export const SEARCH_MODES = ["hybrid", "semantic", "text"] as const;

export const RELATION_TYPES = [
  "supersedes",
  "supports",
  "contradicts",
  "causes",
  "part_of",
  "related_to",
] as const;

export const GRANT_PERMISSIONS = ["read", "context"] as const;

// ============================================================================
// Zod Schemas — Request Validation
// ============================================================================

export const MemoryInputSchema = z.object({
  scope: z.string().min(1).max(200),
  type: z.enum(MEMORY_TYPES),
  subtype: z.string().max(100).optional(),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(50000),
  metadata: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(MEMORY_SOURCES).optional(),
  observed_at: z.string().datetime().optional(),
  valid_from: z.string().datetime().optional(),
  valid_until: z.string().datetime().optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  related_to: z.array(z.string().uuid()).max(50).optional(),
});

export const MemoryUpdateSchema = z.object({
  scope: z.string().min(1).max(200).optional(),
  type: z.enum(MEMORY_TYPES).optional(),
  subtype: z.string().max(100).nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(50000).optional(),
  metadata: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(MEMORY_SOURCES).optional(),
  observed_at: z.string().datetime().optional(),
  valid_from: z.string().datetime().optional(),
  valid_until: z.string().datetime().nullable().optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
});

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  scopes: z.array(z.string()).optional(),
  types: z.array(z.enum(MEMORY_TYPES)).optional(),
  subtypes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata_filter: z.record(z.unknown()).optional(),
  valid_at: z.string().datetime().optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  mode: z.enum(SEARCH_MODES).optional().default("hybrid"),
  include_apps: z.array(z.string()).optional(),
});

export const ContextRequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  scopes: z.array(z.string()).optional(),
  max_tokens: z.number().int().min(100).max(10000).optional().default(2000),
  format: z.enum(CONTEXT_FORMATS).optional().default("xml"),
  filters: z
    .object({
      types: z.array(z.enum(MEMORY_TYPES)).optional(),
      subtypes: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      min_confidence: z.number().min(0).max(1).optional(),
      valid_at: z.string().datetime().optional(),
    })
    .optional(),
  include_apps: z.array(z.string()).optional(),
  strategy: z.enum(CONTEXT_STRATEGIES).optional().default("balanced"),
});

export const BatchOperationSchema = z.object({
  operations: z
    .array(
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          data: MemoryInputSchema,
        }),
        z.object({
          action: z.literal("update"),
          id: z.string().uuid(),
          data: MemoryUpdateSchema,
        }),
        z.object({
          action: z.literal("delete"),
          id: z.string().uuid(),
        }),
      ])
    )
    .min(1)
    .max(100),
});

export const AppInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export const AppTypeInputSchema = z.object({
  id: z.string().min(1).max(100),
  base_type: z.enum(MEMORY_TYPES),
  schema: z.record(z.unknown()).optional(),
  description: z.string().max(1000).optional(),
});

export const GrantInputSchema = z.object({
  granted_app: z.string().min(1).max(50),
  permission: z.enum(GRANT_PERMISSIONS).optional().default("read"),
  scopes: z.array(z.string()).optional(),
});

// ============================================================================
// TypeScript Types (inferred from Zod schemas)
// ============================================================================

export type MemoryInput = z.infer<typeof MemoryInputSchema>;
export type MemoryUpdate = z.infer<typeof MemoryUpdateSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type ContextRequest = z.infer<typeof ContextRequestSchema>;
export type BatchOperation = z.infer<typeof BatchOperationSchema>;
export type AppInput = z.infer<typeof AppInputSchema>;
export type AppTypeInput = z.infer<typeof AppTypeInputSchema>;
export type GrantInput = z.infer<typeof GrantInputSchema>;

/** Stored memory as returned from the database */
export interface Memory {
  id: string;
  tenant_id: string;
  app_id: string;
  scope: string;
  type: string;
  subtype: string | null;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  confidence: number;
  source: string;
  observed_at: string;
  valid_from: string;
  valid_until: string | null;
  superseded_by: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Memory with relevance score from search */
export interface ScoredMemory extends Memory {
  relevance: number;
}

/** Hono app environment type */
export type ApiEnv = {
  Variables: {
    tenantId: string;
    appId: string;
  };
};
