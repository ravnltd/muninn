/**
 * Shutdown Manager
 *
 * Central registry for cleanup functions. Provides orderly shutdown
 * with a hard force-exit backstop so the process never hangs.
 *
 * Usage:
 *   onShutdown(() => db.close());
 *   onShutdown(() => flushFileUpdates());
 *
 * The manager handles SIGTERM/SIGINT and runs all registered cleanups
 * in order, then exits. If cleanup takes longer than FORCE_EXIT_MS,
 * the process is killed.
 */

const FORCE_EXIT_MS = 5_000;

type CleanupFn = () => void | Promise<void>;

const cleanups: CleanupFn[] = [];
let shutdownStarted = false;

/**
 * Register a cleanup function to run on process shutdown.
 * Functions run in registration order. Async functions are awaited.
 */
export function onShutdown(fn: CleanupFn): void {
  cleanups.push(fn);
}

/**
 * Run all registered cleanup functions, then exit.
 * Safe to call multiple times — only the first call runs.
 */
export async function shutdown(code = 0): Promise<never> {
  if (shutdownStarted) {
    // Already shutting down — just wait for force exit
    await new Promise(() => {});
    return undefined as never;
  }
  shutdownStarted = true;

  // Force exit backstop — no matter what, we exit
  const forceTimer = setTimeout(() => process.exit(code), FORCE_EXIT_MS);
  if (typeof forceTimer === "object" && "unref" in forceTimer) forceTimer.unref();

  for (const fn of cleanups) {
    try {
      await fn();
    } catch {
      // Cleanup errors must not prevent other cleanups from running
    }
  }

  process.exit(code);
}

/**
 * Install signal handlers that trigger orderly shutdown.
 * Call once at process startup.
 */
export function installSignalHandlers(): void {
  const handle = () => { shutdown(0); };
  process.on("SIGTERM", handle);
  process.on("SIGINT", handle);
}
