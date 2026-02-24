/**
 * Debug Intent Handler
 *
 * Error fixes + error patterns + relevant learnings
 */

import type { DatabaseAdapter } from "../../../database/adapter.js";
import type { ContextRequest, UnifiedContextResult } from "../types.js";
import {
  collectErrorFixes,
  collectRecentErrors,
  collectQueryResults,
  collectFileInfo,
  collectTestHistory,
} from "../collectors.js";

export async function routeDebugIntent(
  db: DatabaseAdapter,
  projectId: number,
  request: ContextRequest,
  result: UnifiedContextResult,
): Promise<void> {
  const query = request.query ?? request.task ?? "";

  // 1. Known error-fix pairs
  result.meta.sourcesQueried.push("error_fixes");
  await collectErrorFixes(db, projectId, query, result);

  // 2. Recent errors
  result.meta.sourcesQueried.push("errors");
  await collectRecentErrors(db, projectId, result);

  // 3. Relevant learnings (especially gotchas)
  if (query) {
    result.meta.sourcesQueried.push("query");
    await collectQueryResults(db, projectId, query, result);
  }

  // 4. File context if files provided
  if (request.files && request.files.length > 0) {
    result.meta.sourcesQueried.push("files");
    await collectFileInfo(db, projectId, request.files, result);
    await collectTestHistory(db, projectId, request.files, result);
  }
}
