/**
 * Session types — Session, Learning, Pattern, Continuity, Profile, Query, Vector
 */

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  id: number;
  project_id: number;
  started_at: string;
  ended_at: string | null;
  goal: string | null;
  outcome: string | null;
  files_touched: string | null; // JSON array
  files_read: string | null; // JSON array
  patterns_used: string | null; // JSON array
  queries_made: string | null; // JSON array
  decisions_made: string | null; // JSON array
  issues_found: string | null; // JSON array
  issues_resolved: string | null; // JSON array
  learnings: string | null;
  next_steps: string | null;
  success: number | null;
}

// ============================================================================
// Learning & Pattern Types
// ============================================================================

export type LearningCategory = "pattern" | "gotcha" | "preference" | "convention" | "architecture";

export interface Learning {
  id: number;
  project_id: number | null;
  category: LearningCategory;
  title: string;
  content: string;
  context: string | null;
  source: string | null;
  confidence: number;
  times_applied: number;
  last_applied: string | null;
  created_at: string;
  updated_at: string;
  // Continuous learning fields (added in migration 23)
  last_reinforced_at?: string | null;
  decay_rate?: number;
  temperature?: Temperature;
}

// ============================================================================
// Continuous Learning Types (Migration 23)
// ============================================================================

export type ConflictResolution =
  | "a_supersedes"
  | "b_supersedes"
  | "both_valid_conditionally"
  | "merged"
  | "dismissed";

export type ConflictType = "direct" | "conditional" | "scope" | "potential";

export type ContributionType = "influenced" | "contradicted" | "ignored";

export interface LearningConflict {
  id: number;
  learning_a: number;
  learning_b: number;
  conflict_type: ConflictType;
  similarity_score: number | null;
  detected_at: string;
  resolved_at: string | null;
  resolution: ConflictResolution | null;
  resolution_notes: string | null;
}

export interface DecisionLearningLink {
  decision_id: number;
  learning_id: number;
  contribution: ContributionType;
  linked_at: string;
}

export interface LearningVersion {
  id: number;
  learning_id: number;
  version: number;
  content: string;
  confidence: number | null;
  changed_at: string;
  change_reason: string | null;
}

export interface LearningWithEffectiveConfidence extends Learning {
  effectiveConfidence: number;
  daysSinceReinforcement: number;
}

export interface GlobalLearning {
  id: number;
  category: string;
  title: string;
  content: string;
  context: string | null;
  source_project: string | null;
  confidence: number;
  times_applied: number;
  last_applied: string | null;
  created_at: string;
}

export interface Pattern {
  id: number;
  name: string;
  description: string;
  code_example: string | null;
  anti_pattern: string | null;
  applies_to: string | null;
  created_at: string;
}

// ============================================================================
// Query & Search Types
// ============================================================================

export type QueryResultType =
  | "file"
  | "decision"
  | "issue"
  | "learning"
  | "global-learning"
  | "symbol"
  | "observation"
  | "question";

export interface QueryResult {
  type: QueryResultType;
  id: number;
  title: string;
  content: string | null;
  relevance: number;
}

// ============================================================================
// Vector Search Types
// ============================================================================

export type EmbeddingProvider = "voyage" | "disabled";

export interface VectorSearchResult {
  id: number;
  type: QueryResultType;
  title: string;
  content: string | null;
  similarity: number;
}

export interface HybridSearchOptions {
  vectorWeight?: number;
  ftsWeight?: number;
  limit?: number;
  minSimilarity?: number;
}

export interface EmbeddingStats {
  table: string;
  total: number;
  withEmbedding: number;
  coverage: number;
}

// ============================================================================
// Continuity & Self-Improvement Types
// ============================================================================

export type Temperature = "hot" | "warm" | "cold";

export type ObservationType = "pattern" | "frustration" | "insight" | "dropped_thread" | "preference" | "behavior";

export interface Observation {
  id: number;
  project_id: number | null;
  type: ObservationType;
  content: string;
  frequency: number;
  session_id: number | null;
  last_seen_at: string;
  created_at: string;
}

export type QuestionStatus = "open" | "resolved" | "dropped";

export interface OpenQuestion {
  id: number;
  project_id: number | null;
  question: string;
  context: string | null;
  priority: number;
  status: QuestionStatus;
  resolution: string | null;
  session_id: number | null;
  resolved_at: string | null;
  created_at: string;
}

export type TaskType = "code_review" | "debugging" | "feature_build" | "creative" | "research" | "refactor";

// ============================================================================
// Profile Types
// ============================================================================

export type ProfileCategory = "coding_style" | "architecture" | "tooling" | "workflow" | "communication";
export type ProfileSource = "inferred" | "declared" | "observed";

export interface DeveloperProfileEntry {
  id: number;
  project_id: number;
  key: string;
  value: string;
  evidence: string | null;
  confidence: number;
  category: ProfileCategory;
  source: ProfileSource;
  times_confirmed: number;
  last_updated_at: string;
  created_at: string;
}

// ============================================================================
// Outcome & Promotion Types
// ============================================================================

export type OutcomeStatus = "pending" | "succeeded" | "failed" | "revised" | "unknown";

export type PromotionStatus = "not_ready" | "candidate" | "promoted" | "demoted";

// ============================================================================
// Insight Types
// ============================================================================

export type InsightType = "correlation" | "anomaly" | "recommendation" | "pattern";
export type InsightStatus = "new" | "acknowledged" | "dismissed" | "applied";

export interface WorkflowPattern {
  id: number;
  project_id: number | null;
  task_type: TaskType;
  approach: string;
  preferences: string | null; // JSON object
  examples: string | null; // JSON array
  times_used: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}
