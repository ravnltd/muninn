/**
 * Background Task Manager
 *
 * Central manager for fire-and-forget async operations.
 * Limits concurrency, handles errors, and prevents promise storms.
 */

import { createLogger } from "../lib/logger.js";

const log = createLogger("bg-tasks");

const MAX_CONCURRENT = 5;
const TASK_TIMEOUT_MS = 30_000;

interface RunningTask {
  name: string;
  startedAt: number;
  promise: Promise<void>;
}

const running = new Map<string, RunningTask>();

/**
 * Run a background task with error handling and concurrency limit.
 * Returns true if the task was started, false if skipped (at capacity or already running).
 */
export function runBackground(name: string, fn: () => Promise<void>): boolean {
  // Skip if already running
  if (running.has(name)) return false;

  // Skip if at capacity
  if (running.size >= MAX_CONCURRENT) {
    log.debug(`Skipping ${name}: at capacity (${running.size}/${MAX_CONCURRENT})`);
    return false;
  }

  const startedAt = Date.now();

  const promise = Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`Background task timeout: ${name}`)), TASK_TIMEOUT_MS);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    }),
  ])
    .catch((err) => {
      log.debug(`Background task ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      running.delete(name);
    });

  running.set(name, { name, startedAt, promise });
  return true;
}

/**
 * Run only if there's capacity — silently skip otherwise.
 * Use for non-essential tasks that can be dropped.
 */
export function runIfCapacity(name: string, fn: () => Promise<void>): boolean {
  return runBackground(name, fn);
}

/**
 * Get count of currently running background tasks.
 */
export function getRunningCount(): number {
  return running.size;
}

/**
 * Wait for all running tasks to complete (useful in shutdown).
 */
export async function drainAll(timeoutMs = 5000): Promise<void> {
  if (running.size === 0) return;

  const allTasks = Array.from(running.values()).map((t) => t.promise);
  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });

  await Promise.race([Promise.allSettled(allTasks), timeout]);
  running.clear();
}
