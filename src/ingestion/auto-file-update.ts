/**
 * Auto File Knowledge Updater
 *
 * Automatically queues file knowledge updates when Edit/Write tool calls
 * are detected. Runs non-blocking after MCP response is sent.
 *
 * Updates: content_hash, change_count, velocity_score, temperature -> hot
 * Creates: minimal file entry if not yet tracked
 */

import type { DatabaseAdapter } from "../database/adapter";

// ============================================================================
// Types
// ============================================================================

interface FileUpdateJob {
  projectId: number;
  filePath: string;
}

// ============================================================================
// Queue (in-memory, processed async)
// ============================================================================

const pendingUpdates: FileUpdateJob[] = [];
let processing = false;

/**
 * Queue a file for automatic knowledge update.
 * Called by tool logger when Edit/Write tools are detected.
 * Non-blocking — returns immediately.
 */
export function queueFileUpdate(projectId: number, filePath: string): void {
  // Deduplicate
  const exists = pendingUpdates.some(
    (u) => u.projectId === projectId && u.filePath === filePath
  );
  if (!exists) {
    pendingUpdates.push({ projectId, filePath });
  }

  // Trigger processing if not already running
  if (!processing) {
    // Use setTimeout to defer to next tick (after MCP response)
    // .unref() prevents this timer from keeping the event loop alive
    const timer = setTimeout(() => processQueue(), 0);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  }
}

/**
 * Process pending file update queue.
 * Runs asynchronously, never blocks tool responses.
 */
async function processQueue(): Promise<void> {
  if (processing || pendingUpdates.length === 0) return;
  processing = true;

  try {
    // Lazily import to avoid circular dependencies
    const { getGlobalDb } = await import("../database/connection");
    const db = await getGlobalDb();

    while (pendingUpdates.length > 0) {
      const job = pendingUpdates.shift();
      if (!job) break;

      await updateFileKnowledge(db, job.projectId, job.filePath);
    }
  } catch {
    // Swallow errors — auto-update must never break anything
  } finally {
    processing = false;
  }
}

/**
 * Update file knowledge in the database.
 * Increments change_count, updates velocity, sets temperature to hot.
 */
async function updateFileKnowledge(
  db: DatabaseAdapter,
  projectId: number,
  filePath: string
): Promise<void> {
  // Check if file exists in DB
  const existing = await db.get<{ id: number; change_count: number }>(
    `SELECT id, change_count FROM files WHERE project_id = ? AND path = ?`,
    [projectId, filePath]
  );

  if (existing) {
    // Update existing file: increment change_count, set hot, update velocity
    const newCount = existing.change_count + 1;
    await db.run(
      `UPDATE files SET
        change_count = ?,
        temperature = 'hot',
        last_referenced_at = datetime('now'),
        velocity_score = CAST(? AS REAL) / (1 + (julianday('now') - julianday(COALESCE(first_changed_at, created_at)))),
        updated_at = datetime('now')
       WHERE id = ?`,
      [newCount, newCount, existing.id]
    );
  } else {
    // Create minimal file entry for new/untracked files
    await db.run(
      `INSERT OR IGNORE INTO files (project_id, path, purpose, fragility, change_count, temperature, first_changed_at, created_at, updated_at)
       VALUES (?, ?, 'Auto-tracked', 3, 1, 'hot', datetime('now'), datetime('now'), datetime('now'))`,
      [projectId, filePath]
    );
  }
}

/**
 * Manually flush the queue (for testing or shutdown).
 */
export async function flushFileUpdates(): Promise<void> {
  await processQueue();
}
