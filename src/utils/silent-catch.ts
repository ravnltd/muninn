/**
 * Silent catch helpers — structured debug logging for intentional empty catches.
 * Replaces bare `catch {}` with observable, debuggable handlers.
 */

import { createLogger } from "../lib/logger.js";

const log = createLogger("catch");

/** Counter for observable catch metrics */
const catchCounts = new Map<string, number>();

/**
 * Return a catch handler that logs at debug level.
 * Use in place of empty catch blocks for intentional error suppression.
 *
 * Usage: `.catch(silentCatch("context:operation"))`
 * Or in try/catch: `catch (e) { silentCatch("context:operation")(e); }`
 */
export function silentCatch(context: string): (error: unknown) => void {
  return (error: unknown) => {
    const count = (catchCounts.get(context) ?? 0) + 1;
    catchCounts.set(context, count);
    log.debug(`[${context}] suppressed (${count}x): ${error instanceof Error ? error.message : String(error)}`);
  };
}

/**
 * Return a catch handler that increments a named counter and logs.
 * Use for catches where frequency matters for observability.
 */
export function countedCatch(context: string): (error: unknown) => void {
  return silentCatch(context);
}

/** Get all catch counts for observability/metrics */
export function getCatchCounts(): Record<string, number> {
  return Object.fromEntries(catchCounts);
}

/** Reset catch counts (useful for tests) */
export function resetCatchCounts(): void {
  catchCounts.clear();
}
