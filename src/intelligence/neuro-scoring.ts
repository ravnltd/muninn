// @muninn — context in .muninn/context/
/**
 * Neuro-Aware Memory Scoring — state-dependent, emotionally weighted retrieval.
 *
 * Port of huginn/memory/scoring.py (pure math, zero external dependencies).
 *
 * Implements three cognitive principles:
 *   - Recency decay (exponential, half-life ~24h)
 *   - Emotional intensity (dopamine/norepinephrine at encoding)
 *   - State-dependent recall (cosine similarity between neuro states)
 *
 * When Huginn's neuro state is available from Redis, recall results are
 * re-ranked so that memories encoded during a similar emotional state
 * score higher — the same query returns different results during a crisis
 * (high NE) versus calm exploration (high ACh).
 */

/** Neuromodulator state — 4 scalars gating all cognitive processing */
export interface NeuroState {
  dopamine: number;
  serotonin: number;
  norepinephrine: number;
  acetylcholine: number;
}

const NEURO_KEYS: readonly (keyof NeuroState)[] = [
  "dopamine",
  "serotonin",
  "norepinephrine",
  "acetylcholine",
] as const;

/** Half-life for recency decay (hours). A memory from 24h ago scores ~0.5. */
const RECENCY_HALF_LIFE = 24.0;

/** Extract a fixed-order numeric vector from a neuro state. */
function neuroVector(neuro: NeuroState): number[] {
  return NEURO_KEYS.map((k) => neuro[k] ?? 0.0);
}

/** Exponential decay: 1.0 at t=0, 0.5 at t=half_life. */
export function recencyScore(ageHours: number): number {
  if (ageHours <= 0) return 1.0;
  return Math.exp(-0.693 * ageHours / RECENCY_HALF_LIFE);
}

/**
 * How emotionally charged was the moment of encoding.
 *
 * High dopamine = novelty/reward. High norepinephrine = alertness/urgency.
 * Returns 0.3..1.0 so even calm memories have a baseline presence.
 */
export function emotionalIntensity(neuro: NeuroState): number {
  const da = neuro.dopamine ?? 0.3;
  const ne = neuro.norepinephrine ?? 0.2;
  const raw = Math.max(da, ne);
  return 0.3 + 0.7 * Math.min(1.0, raw);
}

/**
 * Cosine similarity between neuro states at encoding and recall.
 *
 * This implements state-dependent memory: you remember better when
 * your current mood matches the mood during encoding.
 * Returns 0.5..1.0 (floor of 0.5 so dissimilar states still allow recall).
 */
export function stateSimilarity(stored: NeuroState, current: NeuroState): number {
  const v1 = neuroVector(stored);
  const v2 = neuroVector(current);
  const dot = v1.reduce((sum, a, i) => sum + a * v2[i], 0);
  const mag1 = Math.sqrt(v1.reduce((sum, a) => sum + a * a, 0)) || 1.0;
  const mag2 = Math.sqrt(v2.reduce((sum, a) => sum + a * a, 0)) || 1.0;
  const cosine = dot / (mag1 * mag2);
  return 0.5 + 0.5 * Math.max(0.0, cosine);
}

/**
 * Score a memory for retrieval using cognitive principles.
 *
 * score = recency * emotional_intensity * state_similarity
 *
 * - Recent memories score higher (exponential decay)
 * - Emotionally intense memories resist decay
 * - Memories encoded in a similar neuro state are easier to recall
 */
export function scoreWithNeuro(
  ageHours: number,
  storedNeuro: NeuroState | null,
  currentNeuro: NeuroState | null,
): number {
  const recency = recencyScore(ageHours);

  if (!storedNeuro || !currentNeuro) return recency;

  const intensity = emotionalIntensity(storedNeuro);
  const similarity = stateSimilarity(storedNeuro, currentNeuro);

  return recency * intensity * similarity;
}

/**
 * Parse a neuro state from a JSON string.
 * Returns null if the string is empty, invalid, or missing keys.
 */
export function parseNeuroState(json: string | null | undefined): NeuroState | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (
      typeof parsed.dopamine === "number" &&
      typeof parsed.serotonin === "number" &&
      typeof parsed.norepinephrine === "number" &&
      typeof parsed.acetylcholine === "number"
    ) {
      return parsed as NeuroState;
    }
    return null;
  } catch {
    return null;
  }
}
