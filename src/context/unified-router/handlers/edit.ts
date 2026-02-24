/**
 * Edit Intent Handler
 *
 * Fragility + contradictions + blast radius + related decisions
 */

import type { DatabaseAdapter } from "../../../database/adapter.js";
import type { ContextRequest, UnifiedContextResult } from "../types.js";
import {
  collectFileInfo,
  collectTestHistory,
  collectCochangers,
  collectContradictions,
  collectFailedDecisions,
  collectFileDecisions,
  collectFileLearnings,
  collectFileIssues,
} from "../collectors.js";

export async function routeEditIntent(
  db: DatabaseAdapter,
  projectId: number,
  _cwd: string,
  request: ContextRequest,
  result: UnifiedContextResult,
): Promise<void> {
  const files = request.files ?? [];

  // 1. File fragility and warnings
  if (files.length > 0) {
    result.meta.sourcesQueried.push("files");
    await collectFileInfo(db, projectId, files, result);
    await collectTestHistory(db, projectId, files, result);
    await collectCochangers(db, projectId, files, result);
  }

  // 2. Contradictions and failed decisions
  result.meta.sourcesQueried.push("decisions");
  await collectContradictions(db, projectId, result);
  await collectFailedDecisions(db, projectId, result);

  // 3. Relevant decisions and learnings for these files
  if (files.length > 0) {
    result.meta.sourcesQueried.push("learnings");
    await collectFileDecisions(db, projectId, files, result);
    await collectFileLearnings(db, projectId, files, result);
  }

  // 4. Open issues for these files
  if (files.length > 0) {
    await collectFileIssues(db, projectId, files, result);
  }
}
