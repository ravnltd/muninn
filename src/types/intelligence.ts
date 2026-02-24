/**
 * Intelligence types — FileCheck, ImpactResult, BlastRadius, Drift, Prediction
 */

import type { StaleFile } from "./project";
import type { OutcomeStatus } from "./session";

// ============================================================================
// Intelligence Types
// ============================================================================

export interface FileCheck {
  path: string;
  warnings: string[];
  suggestions: string[];
  fragility?: number;
  relatedIssues: Array<{ id: number; title: string }>;
  relatedDecisions: Array<{ id: number; title: string }>;
  isStale: boolean;
  correlatedFiles?: Array<{ file: string; cochange_count: number }>;
}

export interface ImpactResult {
  file: string;
  directDependents: string[];
  indirectDependents: string[];
  affectedByDecisions: Array<{ id: number; title: string }>;
  relatedIssues: Array<{ id: number; title: string }>;
  suggestedTests: string[];
  blastSummary?: BlastSummary;
}

// ============================================================================
// Blast Radius Types
// ============================================================================

/** Individual dependency edge in the blast radius graph */
export interface BlastRadiusEdge {
  id: number;
  project_id: number;
  source_file: string; // File being changed
  affected_file: string; // File that would be affected
  distance: number; // Hops: 1=direct, 2+=transitive
  dependency_path: string | null; // JSON array showing path
  is_test: number; // 1 if affected_file is a test
  is_route: number; // 1 if affected_file is a route/page
  computed_at: string;
}

/** Aggregated blast radius summary for a file */
export interface BlastSummary {
  id?: number;
  project_id?: number;
  file_path: string;
  direct_dependents: number; // Count of distance=1
  transitive_dependents: number; // Count of distance>1
  total_affected: number; // Total unique affected files
  max_depth: number; // Deepest transitive chain
  affected_tests: number; // Count of affected test files
  affected_routes: number; // Count of affected route files
  blast_score: number; // Computed risk score (0-100)
  computed_at?: string;
}

/** Full blast radius result for display */
export interface BlastResult {
  file: string;
  summary: BlastSummary;
  directDependents: string[];
  transitiveDependents: Array<{
    file: string;
    distance: number;
    path: string[];
  }>;
  affectedTests: string[];
  affectedRoutes: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
}

/** Blast radius computation options */
export interface BlastComputeOptions {
  maxDepth?: number; // Maximum depth to traverse (default: 10)
  maxFiles?: number; // Maximum files to process (default: 500)
  forceRefresh?: boolean; // Force recomputation even if cached
}

// ============================================================================
// Drift & Status Types
// ============================================================================

export interface DriftResult {
  staleFiles: StaleFile[];
  gitChanges: string[];
  untrackedFiles: string[];
  recommendations: string[];
}

export type ProjectHealth = "good" | "attention" | "critical";

export interface SmartStatus {
  summary: string;
  actions: Array<{ priority: number; action: string; reason: string }>;
  warnings: string[];
  projectHealth: ProjectHealth;
}

export interface FileSuggestion {
  path: string;
  reason: string;
  priority: number;
}

// ============================================================================
// Prediction Types
// ============================================================================

export interface PredictionBundle {
  relatedFiles: Array<{ path: string; reason: string; confidence: number }>;
  cochangingFiles: Array<{ path: string; cochange_count: number }>;
  relevantDecisions: Array<{ id: number; title: string }>;
  openIssues: Array<{ id: number; title: string; severity: number }>;
  applicableLearnings: Array<{ id: number; title: string; content: string; native?: string }>;
  workflowPattern: { task_type: string; approach: string } | null;
  profileEntries: Array<{ key: string; value: string; confidence: number; category: string }>;
  // Session context from relationship graph
  lastSessionContext: {
    sessionId: number;
    goal: string | null;
    decisionsMade: Array<{ id: number; title: string }>;
    issuesFound: Array<{ id: number; title: string }>;
    issuesResolved: Array<{ id: number; title: string }>;
    learningsExtracted: Array<{ id: number; title: string }>;
  } | null;
  // Test files for input files (test -> source relationships)
  testFiles: Array<{ testPath: string; sourcePath: string }>;
  // Advisory section (when --advise flag is used)
  advisory?: PredictionAdvisory;
}

export interface PredictionAdvisory {
  riskLevel: "low" | "medium" | "high";
  riskScore: number; // 0-10
  suggestedApproach: string | null;
  watchOut: Array<{
    warning: string;
    source: string; // e.g., "learning #12" or "decision #8 (failed)"
    severity: "info" | "warning" | "critical";
  }>;
  decisionOutcomes: Array<{
    id: number;
    title: string;
    outcome: OutcomeStatus;
    notes: string | null;
  }>;
  suggestedSteps: string[];
}
