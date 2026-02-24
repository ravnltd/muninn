/**
 * Explore Intent Handler
 *
 * Broad search across all knowledge types
 */

import type { DatabaseAdapter } from "../../../database/adapter.js";
import type { ContextRequest, UnifiedContextResult } from "../types.js";
import { collectQueryResults, collectSuggestedFiles } from "../collectors.js";

export async function routeExploreIntent(
  db: DatabaseAdapter,
  projectId: number,
  request: ContextRequest,
  result: UnifiedContextResult,
): Promise<void> {
  const query = request.query ?? request.task ?? "";

  if (query) {
    result.meta.sourcesQueried.push("query");
    await collectQueryResults(db, projectId, query, result);
  }

  // Suggest related files
  if (request.task) {
    result.meta.sourcesQueried.push("suggest");
    await collectSuggestedFiles(db, projectId, request.task, result);
  }
}
