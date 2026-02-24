/**
 * Silent Catch Helpers — Replace empty catch blocks with observable ones
 *
 * Usage:
 *   } catch { silentCatch("context-shifter.loadFocus"); }
 *   } catch { countedCatch("budget-manager.loadOverrides", metrics.catch); }
 */
import { createLogger } from "../lib/logger.js";

const logger = createLogger("catch");

export function silentCatch(context: string): void {
  logger.debug(`Suppressed error in ${context}`);
}

export function countedCatch(context: string, counter?: { increment: () => void }): void {
  logger.debug(`Suppressed error in ${context}`);
  counter?.increment();
}
