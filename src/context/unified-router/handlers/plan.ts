/**
 * Plan Intent Handler
 *
 * Full advisory with risk assessment
 */

import type { DatabaseAdapter } from "../../../database/adapter.js";
import type { ContextRequest, UnifiedContextResult } from "../types.js";
import {
  collectContradictions,
  collectFailedDecisions,
  collectQueryResults,
  collectSuggestedFiles,
  collectFileInfo,
  collectCochangers,
  collectOpenIssues,
} from "../collectors.js";

export async function routePlanIntent(
  db: DatabaseAdapter,
  projectId: number,
  request: ContextRequest,
  result: UnifiedContextResult,
): Promise<void> {
  const task = request.task ?? request.query ?? "";

  // 1. Contradictions and failed decisions first
  result.meta.sourcesQueried.push("decisions");
  await collectContradictions(db, projectId, result);
  await collectFailedDecisions(db, projectId, result);

  // 2. Relevant knowledge for the task
  if (task) {
    result.meta.sourcesQueried.push("query");
    await collectQueryResults(db, projectId, task, result);
  }

  // 3. Suggested files
  if (task) {
    result.meta.sourcesQueried.push("suggest");
    await collectSuggestedFiles(db, projectId, task, result);
  }

  // 4. File context if files provided
  if (request.files && request.files.length > 0) {
    result.meta.sourcesQueried.push("files");
    await collectFileInfo(db, projectId, request.files, result);
    await collectCochangers(db, projectId, request.files, result);
  }

  // 5. Open issues
  result.meta.sourcesQueried.push("issues");
  await collectOpenIssues(db, projectId, result);
}
