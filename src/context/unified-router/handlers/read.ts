/**
 * Read Intent Handler
 *
 * Lightweight context for understanding files
 */

import type { DatabaseAdapter } from "../../../database/adapter.js";
import type { ContextRequest, UnifiedContextResult } from "../types.js";
import {
  collectFileInfo,
  collectQueryResults,
  collectFileDecisions,
  collectFileLearnings,
} from "../collectors.js";

export async function routeReadIntent(
  db: DatabaseAdapter,
  projectId: number,
  request: ContextRequest,
  result: UnifiedContextResult,
): Promise<void> {
  const files = request.files ?? [];

  if (files.length > 0) {
    result.meta.sourcesQueried.push("files");
    await collectFileInfo(db, projectId, files, result);
  }

  // Relevant decisions and learnings
  if (request.query) {
    result.meta.sourcesQueried.push("query");
    await collectQueryResults(db, projectId, request.query, result);
  } else if (files.length > 0) {
    result.meta.sourcesQueried.push("decisions", "learnings");
    await collectFileDecisions(db, projectId, files, result);
    await collectFileLearnings(db, projectId, files, result);
  }
}
