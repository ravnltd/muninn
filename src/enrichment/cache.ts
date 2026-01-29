/**
 * LRU Cache for Enrichment Layer
 *
 * Provides fast caching with TTL support for enrichment data.
 * Uses a simple Map-based LRU implementation.
 */

import type { CacheEntry, EnrichmentCache } from "./types";

// ============================================================================
// LRU Cache Implementation
// ============================================================================

export class LRUCache implements EnrichmentCache {
  private cache: Map<string, CacheEntry<unknown>>;
  private maxSize: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const expiresAt = ttlMs ? Date.now() + ttlMs : 0;
    this.cache.set(key, { value, expiresAt });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if expired
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
    };
  }

  /**
   * Clean up expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }
}

// ============================================================================
// Cache Key Generators
// ============================================================================

export function fileKey(projectId: number, path: string): string {
  return `file:${projectId}:${path}`;
}

export function blastKey(projectId: number, path: string): string {
  return `blast:${projectId}:${path}`;
}

export function correlationKey(projectId: number, path: string): string {
  return `corr:${projectId}:${path}`;
}

export function issueKey(projectId: number, path: string): string {
  return `issue:${projectId}:${path}`;
}

export function decisionKey(projectId: number, path: string): string {
  return `decision:${projectId}:${path}`;
}

export function learningKey(projectId: number, query: string): string {
  return `learning:${projectId}:${query}`;
}

export function testFileKey(projectId: number, path: string): string {
  return `test:${projectId}:${path}`;
}
