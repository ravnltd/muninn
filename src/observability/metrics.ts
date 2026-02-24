/**
 * Observability Metrics — In-memory counters for server health
 *
 * Resets on restart. Designed for zero-cost in the hot path.
 */

const counters = new Map<string, number>();
const durations = new Map<string, number[]>();

export function increment(category: string, subcategory: string): void {
  const key = `${category}.${subcategory}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function recordDuration(category: string, ms: number): void {
  const existing = durations.get(category);
  if (existing) {
    existing.push(ms);
    if (existing.length > 100) existing.shift();
  } else {
    durations.set(category, [ms]);
  }
}

export function getCount(category: string, subcategory: string): number {
  return counters.get(`${category}.${subcategory}`) ?? 0;
}

export function getMetrics(): {
  counters: Record<string, number>;
  durations: Record<string, { count: number; avg: number; p95: number }>;
} {
  const counterObj: Record<string, number> = {};
  for (const [key, value] of counters) {
    counterObj[key] = value;
  }

  const durationObj: Record<string, { count: number; avg: number; p95: number }> = {};
  for (const [key, values] of durations) {
    const sorted = [...values].sort((a, b) => a - b);
    const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    const p95Index = Math.floor(sorted.length * 0.95);
    durationObj[key] = {
      count: sorted.length,
      avg: Math.round(avg),
      p95: sorted[p95Index] ?? sorted[sorted.length - 1] ?? 0,
    };
  }

  return { counters: counterObj, durations: durationObj };
}

export function resetMetrics(): void {
  counters.clear();
  durations.clear();
}
