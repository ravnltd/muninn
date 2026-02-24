/**
 * Session Lifecycle State
 *
 * Tracks per-session initialization flags and caches.
 */

export interface BudgetOverrides {
  contradictions: number;
  criticalWarnings: number;
  strategies: number;
  decisions: number;
  learnings: number;
  fileContext: number;
  errorFixes: number;
  reserve: number;
}

export interface SessionLifecycle {
  autoStarted: boolean;
  taskAnalyzed: boolean;
  embeddingCacheWarmed: boolean;
  budgetWeightsLoaded: boolean;
  cachedBudgetWeights: Record<string, number>;
  cachedBudgetOverrides: BudgetOverrides | null;
  cachedStrategies: Array<{ id: number; name: string; steps: string; context: string; confidence: number }>;
}

const DEFAULT_SESSION: SessionLifecycle = {
  autoStarted: false,
  taskAnalyzed: false,
  embeddingCacheWarmed: false,
  budgetWeightsLoaded: false,
  cachedBudgetWeights: {},
  cachedBudgetOverrides: null,
  cachedStrategies: [],
};

let session: SessionLifecycle = { ...DEFAULT_SESSION };

export function getSession(): SessionLifecycle {
  return session;
}

export function updateSession(updates: Partial<SessionLifecycle>): void {
  session = { ...session, ...updates };
}

export function resetSession(): void {
  session = { ...DEFAULT_SESSION };
}
