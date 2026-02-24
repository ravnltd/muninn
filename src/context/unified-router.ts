/**
 * Unified Context Router — barrel re-export
 *
 * The implementation has been split into src/context/unified-router/.
 * This file re-exports everything to preserve the public API.
 */

export {
  routeContext,
  sanitizeFtsQuery,
} from "./unified-router/index.js";

export type {
  ContextIntent,
  ContextRequest,
  ContextWarning,
  ContextFileInfo,
  ContextKnowledge,
  UnifiedContextResult,
} from "./unified-router/index.js";
