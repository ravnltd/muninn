/**
 * Unified Context Router — Types
 */

export type ContextIntent = "edit" | "read" | "debug" | "explore" | "plan";

export interface ContextRequest {
  intent: ContextIntent;
  files?: string[];
  query?: string;
  task?: string;
}

export interface ContextWarning {
  type: "fragility" | "contradiction" | "failed_decision" | "stale" | "test_failure";
  severity: "critical" | "warning" | "info";
  message: string;
  file?: string;
}

export interface ContextFileInfo {
  path: string;
  fragility: number;
  purpose?: string;
  cochangers?: string[];
  testFiles?: string[];
  historicalFailureRate?: number;
}

export interface ContextKnowledge {
  type: "decision" | "learning" | "error_fix" | "issue" | "strategy";
  title: string;
  content: string;
  confidence?: number;
  status?: string;
}

export interface UnifiedContextResult {
  warnings: ContextWarning[];
  context: ContextKnowledge[];
  files: ContextFileInfo[];
  meta: {
    intent: ContextIntent;
    tokensUsed: number;
    sourcesQueried: string[];
  };
}
