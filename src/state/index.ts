/**
 * State Module — Barrel Export
 */
export { getPhase, transitionToReady, resetPhase, isReady, type McpPhase } from "./machine.js";
export {
  getSession,
  updateSession,
  resetSession,
  type SessionLifecycle,
  type BudgetOverrides,
} from "./session.js";
export {
  getHealthCounters,
  setKeepaliveFailures,
  setSlowCalls,
  setLastWorkerSpawn,
  canSpawnWorker,
  recordException,
  getExceptionCount,
  EXCEPTION_WINDOW_MS,
  MAX_EXCEPTIONS_IN_WINDOW,
  WORKER_SPAWN_COOLDOWN_MS,
} from "./health.js";
export { ALLOWED_PASSTHROUGH_COMMANDS } from "./constants.js";
export { buildCalibratedContext, DEFAULT_ALLOCATION } from "./context.js";
