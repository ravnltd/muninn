/**
 * Built-in Enrichers
 *
 * Exports all enrichers and provides a function to register them with the engine.
 */

import type { EnrichmentEngine } from "../engine";

// Import all enrichers
import { FileKnowledgeEnricher } from "./file-knowledge";
import { BlockerEnricher } from "./blocker";
import { LearningsEnricher } from "./learnings";
import { IssuesEnricher } from "./issues";
import { DecisionsEnricher } from "./decisions";
import { BlastRadiusEnricher } from "./blast-radius";
import { CodeIntelEnricher } from "./code-intel";
import { CorrelationsEnricher } from "./correlations";
import { TestsEnricher } from "./tests";

// Re-export enricher classes
export { FileKnowledgeEnricher } from "./file-knowledge";
export { BlockerEnricher } from "./blocker";
export { LearningsEnricher } from "./learnings";
export { IssuesEnricher } from "./issues";
export { DecisionsEnricher } from "./decisions";
export { BlastRadiusEnricher } from "./blast-radius";
export { CodeIntelEnricher } from "./code-intel";
export { CorrelationsEnricher } from "./correlations";
export { TestsEnricher } from "./tests";

/**
 * Register all built-in enrichers with the engine
 */
export function registerBuiltinEnrichers(engine: EnrichmentEngine): void {
  const registry = engine.getRegistry();

  // Register in priority order (lower = runs first)
  registry.register(new FileKnowledgeEnricher()); // 10
  registry.register(new BlockerEnricher()); // 20
  registry.register(new LearningsEnricher()); // 30
  registry.register(new IssuesEnricher()); // 40
  registry.register(new DecisionsEnricher()); // 50
  registry.register(new BlastRadiusEnricher()); // 60
  registry.register(new CodeIntelEnricher()); // 65
  registry.register(new CorrelationsEnricher()); // 70
  registry.register(new TestsEnricher()); // 80
}

/**
 * Create all built-in enrichers (for manual registration)
 */
export function createBuiltinEnrichers() {
  return [
    new FileKnowledgeEnricher(),
    new BlockerEnricher(),
    new LearningsEnricher(),
    new IssuesEnricher(),
    new DecisionsEnricher(),
    new BlastRadiusEnricher(),
    new CodeIntelEnricher(),
    new CorrelationsEnricher(),
    new TestsEnricher(),
  ];
}
