/**
 * Project types — Project, File, Decision, Issue, TechDebt
 */

// ============================================================================
// Project Types
// ============================================================================

export type ProjectMode = "exploring" | "building" | "hardening" | "shipping" | "maintaining";

export interface Project {
  id: number;
  path: string;
  name: string;
  type: string | null;
  stack: string | null; // JSON array
  status: "active" | "maintenance" | "archived";
  mode: ProjectMode; // Phase awareness for behavior adjustment
  created_at: string;
  updated_at: string;
}

export interface ModeTransition {
  id: number;
  project_id: number;
  from_mode: ProjectMode | null;
  to_mode: ProjectMode;
  reason: string | null;
  transitioned_at: string;
}

export interface ProjectState extends Project {
  file_count: number;
  open_issues: number;
  active_decisions: number;
  last_goal: string | null;
  pending_next_steps: string | null;
}

// ============================================================================
// File Types
// ============================================================================

export type FileType =
  | "component"
  | "route"
  | "util"
  | "config"
  | "schema"
  | "service"
  | "hook"
  | "middleware"
  | "test"
  | "other";
export type FileStatus = "active" | "deprecated" | "do-not-touch" | "generated";

export interface FileRecord {
  id: number;
  project_id: number;
  path: string;
  type: FileType | null;
  purpose: string | null;
  exports: string | null; // JSON array
  dependencies: string | null; // JSON array
  dependents: string | null; // JSON array
  fragility: number;
  fragility_reason: string | null;
  status: FileStatus;
  last_modified: string | null;
  last_analyzed: string | null;
  content_hash: string | null;
  fs_modified_at: string | null;
  last_queried_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveredFile {
  path: string;
  type: "code" | "config" | "doc" | "other";
  size: number;
  content?: string;
}

export interface StaleFile {
  path: string;
  lastAnalyzed: string;
  fsModified: string;
  status: "stale" | "outdated" | "missing";
  reason: string;
}

// ============================================================================
// Decision & Issue Types
// ============================================================================

export type DecisionStatus = "active" | "superseded" | "reconsidering";
export type ConstraintType = "must_hold" | "should_hold" | "nice_to_have";
export type DecisionLinkType = "depends_on" | "invalidates" | "requires_reconsider" | "supersedes" | "contradicts";

export interface Decision {
  id: number;
  project_id: number;
  title: string;
  decision: string;
  reasoning: string | null;
  alternatives: string | null; // JSON array
  consequences: string | null; // JSON array
  affects: string | null; // JSON array
  status: DecisionStatus;
  superseded_by: number | null;
  invariant: string | null; // The deeper WHY - constraint that must hold
  constraint_type: ConstraintType; // How critical is this invariant
  decided_at: string;
  created_at: string;
}

export interface DecisionLink {
  id: number;
  decision_id: number;
  linked_decision_id: number;
  link_type: DecisionLinkType;
  strength: number; // 0-1 how tightly coupled
  reason: string | null;
  created_at: string;
}

export interface DecisionRipple {
  decision_id: number;
  decision_title: string;
  link_type: DecisionLinkType;
  strength: number;
  linked_id: number;
  linked_title: string;
  linked_status: DecisionStatus;
}

export type IssueType = "bug" | "tech-debt" | "enhancement" | "question" | "potential";
export type IssueStatus = "open" | "in-progress" | "resolved" | "wont-fix";

export interface Issue {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  type: IssueType;
  severity: number;
  status: IssueStatus;
  affected_files: string | null; // JSON array
  related_symbols: string | null; // JSON array
  workaround: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Tech Debt Types
// ============================================================================

export type DebtEffort = "small" | "medium" | "large";
export type DebtStatus = "open" | "in-progress" | "resolved";

export interface TechDebt {
  id: number;
  project_path: string;
  title: string;
  description: string | null;
  severity: number;
  effort: DebtEffort | null;
  affected_files: string | null; // JSON array
  status: DebtStatus;
  created_at: string;
}
