/**
 * Unified Context Router — v7 Phase 1A
 *
 * Routes context requests by intent, composing results from existing
 * subsystems (check, query, predict, suggest, enrich).
 *
 * This is the single entry point agents need instead of choosing
 * between 5 separate search tools.
 */

import type { DatabaseAdapter } from "../../database/adapter.js";
import type { ContextRequest, UnifiedContextResult } from "./types.js";
import { routeEditIntent } from "./handlers/edit.js";
import { routeReadIntent } from "./handlers/read.js";
import { routeDebugIntent } from "./handlers/debug.js";
import { routeExploreIntent } from "./handlers/explore.js";
import { routePlanIntent } from "./handlers/plan.js";
import { injectIntelligence } from "./intelligence.js";

// Re-export all public types and utilities
export type {
  ContextIntent,
  ContextRequest,
  ContextWarning,
  ContextFileInfo,
  ContextKnowledge,
  UnifiedContextResult,
} from "./types.js";

export { sanitizeFtsQuery } from "./collectors.js";

/**
 * Route a context request based on intent.
 * Composes results from existing subsystems without duplication.
 */
export async function routeContext(
  db: DatabaseAdapter,
  projectId: number,
  cwd: string,
  request: ContextRequest,
): Promise<UnifiedContextResult> {
  const result: UnifiedContextResult = {
    warnings: [],
    context: [],
    files: [],
    meta: {
      intent: request.intent,
      tokensUsed: 0,
      sourcesQueried: [],
    },
  };

  switch (request.intent) {
    case "edit":
      await routeEditIntent(db, projectId, cwd, request, result);
      break;
    case "read":
      await routeReadIntent(db, projectId, request, result);
      break;
    case "debug":
      await routeDebugIntent(db, projectId, request, result);
      break;
    case "explore":
      await routeExploreIntent(db, projectId, request, result);
      break;
    case "plan":
      await routePlanIntent(db, projectId, request, result);
      break;
  }

  // --- v7 Loop Closure: Inject intelligence signals ---
  await injectIntelligence(db, projectId, request, result);

  return result;
}
