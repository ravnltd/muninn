/**
 * Health Counters — Track server health metrics
 */

export interface HealthCounters {
  consecutiveKeepaliveFailures: number;
  consecutiveSlowCalls: number;
  exceptionWindow: number[];
  lastWorkerSpawnAt: number;
}

const EXCEPTION_WINDOW_MS = 120_000;
const MAX_EXCEPTIONS_IN_WINDOW = 30;
const WORKER_SPAWN_COOLDOWN_MS = 5 * 60_000;

const state: HealthCounters = {
  consecutiveKeepaliveFailures: 0,
  consecutiveSlowCalls: 0,
  exceptionWindow: [],
  lastWorkerSpawnAt: 0,
};

export function getHealthCounters(): HealthCounters {
  return state;
}

export function setKeepaliveFailures(n: number): void {
  state.consecutiveKeepaliveFailures = n;
}

export function setSlowCalls(n: number): void {
  state.consecutiveSlowCalls = n;
}

export function setLastWorkerSpawn(ts: number): void {
  state.lastWorkerSpawnAt = ts;
}

export function canSpawnWorker(): boolean {
  return Date.now() - state.lastWorkerSpawnAt > WORKER_SPAWN_COOLDOWN_MS;
}

export function recordException(): boolean {
  const now = Date.now();
  state.exceptionWindow.push(now);

  // Trim old entries
  const cutoff = now - EXCEPTION_WINDOW_MS;
  while (state.exceptionWindow.length > 0 && state.exceptionWindow[0] < cutoff) {
    state.exceptionWindow.shift();
  }

  return state.exceptionWindow.length >= MAX_EXCEPTIONS_IN_WINDOW;
}

export function getExceptionCount(): number {
  return state.exceptionWindow.length;
}

export { EXCEPTION_WINDOW_MS, MAX_EXCEPTIONS_IN_WINDOW, WORKER_SPAWN_COOLDOWN_MS };
