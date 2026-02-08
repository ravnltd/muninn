/**
 * Memory Store Service
 *
 * CRUD operations for the unified memories table.
 * Embeds content on creation via Voyage AI.
 * Manages relations and soft deletes.
 */

import { getDb } from "../db/postgres";
import { embed, toVectorLiteral } from "./embedder";
import type { Memory, MemoryInput, MemoryUpdate } from "../types";

// ============================================================================
// Create
// ============================================================================

interface CreateResult {
  memory: Memory;
  embedding_status: "completed" | "pending" | "failed";
}

export async function createMemory(
  tenantId: string,
  appId: string,
  input: MemoryInput
): Promise<CreateResult> {
  const db = getDb();

  // Generate embedding from title + content
  const textForEmbedding = `${input.title}\n${input.content}`;
  const embedding = await embed(textForEmbedding);

  const embeddingStatus = embedding ? "completed" : "failed";

  const rows = await db`
    INSERT INTO memories (
      tenant_id, app_id, scope, type, subtype,
      title, content, metadata, confidence, source,
      observed_at, valid_from, valid_until,
      embedding, tags
    ) VALUES (
      ${tenantId}, ${appId}, ${input.scope}, ${input.type}, ${input.subtype ?? null},
      ${input.title}, ${input.content}, ${JSON.stringify(input.metadata ?? {})},
      ${input.confidence ?? 0.7}, ${input.source ?? "user"},
      ${input.observed_at ?? new Date().toISOString()},
      ${input.valid_from ?? new Date().toISOString()},
      ${input.valid_until ?? null},
      ${embedding ? toVectorLiteral(embedding) : null}::vector,
      ${input.tags ?? []}
    )
    RETURNING
      id, tenant_id, app_id, scope, type, subtype,
      title, content, metadata, confidence, source,
      observed_at::text, valid_from::text, valid_until::text,
      superseded_by, tags,
      created_at::text, updated_at::text, deleted_at::text
  `;

  const memory = rows[0] as Memory;

  // Create relations if specified
  if (input.related_to && input.related_to.length > 0) {
    await createRelations(memory.id, input.related_to);
  }

  return { memory, embedding_status: embeddingStatus };
}

// ============================================================================
// Read
// ============================================================================

export async function getMemory(
  tenantId: string,
  memoryId: string
): Promise<Memory | null> {
  const db = getDb();

  const rows = await db`
    SELECT
      id, tenant_id, app_id, scope, type, subtype,
      title, content, metadata, confidence, source,
      observed_at::text, valid_from::text, valid_until::text,
      superseded_by, tags,
      created_at::text, updated_at::text, deleted_at::text
    FROM memories
    WHERE id = ${memoryId}
      AND tenant_id = ${tenantId}
      AND deleted_at IS NULL
  `;

  return (rows[0] as Memory) ?? null;
}

// ============================================================================
// Update
// ============================================================================

export async function updateMemory(
  tenantId: string,
  memoryId: string,
  update: MemoryUpdate
): Promise<Memory | null> {
  const db = getDb();

  // Check existence first
  const existing = await getMemory(tenantId, memoryId);
  if (!existing) return null;

  // Explicit whitelist of allowed update columns
  const ALLOWED_COLUMNS = new Set([
    "scope", "type", "subtype", "title", "content",
    "confidence", "source", "observed_at", "valid_from",
    "valid_until", "tags", "updated_at",
  ]);

  // Build update object for postgres.js dynamic SET helper
  const sets: Record<string, string | number | string[] | null> = {
    updated_at: new Date().toISOString(),
  };

  if (update.scope !== undefined) sets.scope = update.scope;
  if (update.type !== undefined) sets.type = update.type;
  if (update.subtype !== undefined) sets.subtype = update.subtype ?? null;
  if (update.title !== undefined) sets.title = update.title;
  if (update.content !== undefined) sets.content = update.content;
  if (update.confidence !== undefined) sets.confidence = update.confidence;
  if (update.source !== undefined) sets.source = update.source;
  if (update.observed_at !== undefined) sets.observed_at = update.observed_at;
  if (update.valid_from !== undefined) sets.valid_from = update.valid_from;
  if (update.valid_until !== undefined) sets.valid_until = update.valid_until ?? null;
  if (update.tags !== undefined) sets.tags = update.tags ?? [];

  // Re-embed if title or content changed
  const needsReembed = update.title !== undefined || update.content !== undefined;
  let embeddingFragment = db``;
  if (needsReembed) {
    const title = update.title ?? existing.title;
    const content = update.content ?? existing.content;
    const embedding = await embed(`${title}\n${content}`);
    if (embedding) {
      embeddingFragment = db`, embedding = ${toVectorLiteral(embedding)}::vector`;
    }
  }

  // Handle metadata separately (needs ::jsonb cast)
  let metadataFragment = db``;
  if (update.metadata !== undefined) {
    metadataFragment = db`, metadata = ${JSON.stringify(update.metadata)}::jsonb`;
  }

  // Only allow whitelisted columns
  const columns = Object.keys(sets).filter((col) => ALLOWED_COLUMNS.has(col));
  const rows = await db`
    UPDATE memories
    SET ${db(sets, columns)} ${metadataFragment} ${embeddingFragment}
    WHERE id = ${memoryId}
      AND tenant_id = ${tenantId}
      AND deleted_at IS NULL
    RETURNING
      id, tenant_id, app_id, scope, type, subtype,
      title, content, metadata, confidence, source,
      observed_at::text, valid_from::text, valid_until::text,
      superseded_by, tags,
      created_at::text, updated_at::text, deleted_at::text
  `;

  return (rows[0] as Memory) ?? null;
}

// ============================================================================
// Delete (Soft)
// ============================================================================

export async function deleteMemory(
  tenantId: string,
  memoryId: string
): Promise<boolean> {
  const db = getDb();

  const result = await db`
    UPDATE memories
    SET deleted_at = NOW()
    WHERE id = ${memoryId}
      AND tenant_id = ${tenantId}
      AND deleted_at IS NULL
  `;

  return result.count > 0;
}

// ============================================================================
// Batch Operations
// ============================================================================

interface BatchResult {
  action: string;
  id: string;
  status: "success" | "error";
  error?: string;
}

interface BatchCreateOp {
  action: "create";
  data: MemoryInput;
}

interface BatchUpdateOp {
  action: "update";
  id: string;
  data: MemoryUpdate;
}

interface BatchDeleteOp {
  action: "delete";
  id: string;
}

type BatchOp = BatchCreateOp | BatchUpdateOp | BatchDeleteOp;

export async function batchOperations(
  tenantId: string,
  appId: string,
  operations: BatchOp[]
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (const op of operations) {
    try {
      switch (op.action) {
        case "create": {
          const { memory } = await createMemory(tenantId, appId, op.data);
          results.push({ action: "create", id: memory.id, status: "success" });
          break;
        }
        case "update": {
          const updated = await updateMemory(tenantId, op.id, op.data);
          if (updated) {
            results.push({ action: "update", id: op.id, status: "success" });
          } else {
            results.push({
              action: "update",
              id: op.id,
              status: "error",
              error: "Memory not found",
            });
          }
          break;
        }
        case "delete": {
          const deleted = await deleteMemory(tenantId, op.id);
          if (deleted) {
            results.push({ action: "delete", id: op.id, status: "success" });
          } else {
            results.push({
              action: "delete",
              id: op.id,
              status: "error",
              error: "Memory not found",
            });
          }
          break;
        }
      }
    } catch (error) {
      const id = "id" in op ? op.id : "new";
      const message =
        error instanceof Error ? error.message : "Unknown error";
      results.push({ action: op.action, id, status: "error", error: message });
    }
  }

  return results;
}

// ============================================================================
// Relations
// ============================================================================

async function createRelations(
  sourceId: string,
  targetIds: string[]
): Promise<void> {
  const db = getDb();

  for (const targetId of targetIds) {
    await db`
      INSERT INTO memory_relations (source_id, target_id, relation)
      VALUES (${sourceId}, ${targetId}, 'related_to')
      ON CONFLICT (source_id, target_id, relation) DO NOTHING
    `.catch(() => {
      // Target might not exist, skip silently
    });
  }
}
