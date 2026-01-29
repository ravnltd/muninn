/**
 * Enricher Registry
 *
 * Manages registration and retrieval of enrichers.
 * Supports enabling/disabling and configuration of individual enrichers.
 */

import type { Enricher, EnricherConfig, EnrichmentConfig, EnrichmentInput, ToolType } from "./types";

// ============================================================================
// Registry Class
// ============================================================================

export class EnricherRegistry {
  private enrichers: Map<string, Enricher> = new Map();
  private config: EnrichmentConfig;

  constructor(config: EnrichmentConfig) {
    this.config = config;
  }

  /**
   * Register an enricher
   */
  register(enricher: Enricher): void {
    // Apply config overrides if present
    const overrides = this.config.enrichers[enricher.name];
    if (overrides) {
      Object.assign(enricher, overrides);
    }

    this.enrichers.set(enricher.name, enricher);
  }

  /**
   * Register multiple enrichers
   */
  registerAll(enrichers: Enricher[]): void {
    for (const enricher of enrichers) {
      this.register(enricher);
    }
  }

  /**
   * Get an enricher by name
   */
  get(name: string): Enricher | undefined {
    return this.enrichers.get(name);
  }

  /**
   * Get all registered enrichers
   */
  all(): Enricher[] {
    return Array.from(this.enrichers.values());
  }

  /**
   * Get enrichers applicable for the given input, sorted by priority
   */
  getApplicable(input: EnrichmentInput): Enricher[] {
    return this.all()
      .filter((e) => e.enabled)
      .filter((e) => this.supportsInput(e, input))
      .filter((e) => e.canEnrich(input))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if an enricher supports the given input
   */
  private supportsInput(enricher: Enricher, input: EnrichmentInput): boolean {
    // "*" matches all tools
    if (enricher.supportedTools.includes("*")) {
      return true;
    }

    // Check if the tool is in the supported list
    return enricher.supportedTools.includes(input.tool);
  }

  /**
   * Enable an enricher
   */
  enable(name: string): boolean {
    const enricher = this.enrichers.get(name);
    if (enricher) {
      enricher.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * Disable an enricher
   */
  disable(name: string): boolean {
    const enricher = this.enrichers.get(name);
    if (enricher) {
      enricher.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Update enricher configuration
   */
  configure(name: string, config: Partial<EnricherConfig>): boolean {
    const enricher = this.enrichers.get(name);
    if (enricher) {
      Object.assign(enricher, config);
      return true;
    }
    return false;
  }

  /**
   * Get enricher names
   */
  names(): string[] {
    return Array.from(this.enrichers.keys());
  }

  /**
   * Get count of registered enrichers
   */
  size(): number {
    return this.enrichers.size;
  }

  /**
   * Clear all enrichers
   */
  clear(): void {
    this.enrichers.clear();
  }

  /**
   * Get status of all enrichers
   */
  status(): Array<{ name: string; enabled: boolean; priority: number; tools: ToolType[] }> {
    return this.all().map((e) => ({
      name: e.name,
      enabled: e.enabled,
      priority: e.priority,
      tools: e.supportedTools,
    }));
  }
}

// ============================================================================
// Base Enricher Class
// ============================================================================

/**
 * Abstract base class for enrichers
 */
export abstract class BaseEnricher implements Enricher {
  name: string;
  priority: number;
  supportedTools: ToolType[];
  tokenBudget: number;
  enabled: boolean;

  constructor(config: EnricherConfig) {
    this.name = config.name;
    this.priority = config.priority;
    this.supportedTools = config.supportedTools;
    this.tokenBudget = config.tokenBudget;
    this.enabled = config.enabled;
  }

  /**
   * Default implementation: always can enrich if tool is supported
   */
  canEnrich(input: EnrichmentInput): boolean {
    return input.files.length > 0;
  }

  /**
   * Subclasses must implement this
   */
  abstract enrich(
    input: EnrichmentInput,
    context: import("./types").EnrichmentContext
  ): Promise<import("./types").EnricherOutput | null>;

  /**
   * Helper to create output object
   */
  protected output(content: string): import("./types").EnricherOutput {
    return {
      name: this.name,
      priority: this.priority,
      content,
      tokens: Math.ceil(content.length / 4),
    };
  }

  /**
   * Helper to create blocked output
   */
  protected blocked(
    reason: string,
    level: import("./types").BlockLevel,
    operationId?: string
  ): import("./types").EnricherOutput {
    return {
      name: this.name,
      priority: this.priority,
      content: "",
      tokens: 0,
      blocked: { level, reason, operationId },
    };
  }
}
