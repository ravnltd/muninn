/**
 * Type definitions for Claude Context Engine
 * All interfaces and types used throughout the application
 */

// ============================================================================
// Server Roles & Status
// ============================================================================

export type ServerRole = 'production' | 'staging' | 'homelab' | 'development';
export type ServerStatus = 'online' | 'offline' | 'degraded' | 'unknown';
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded' | 'unknown';
export type ServiceStatus = 'running' | 'stopped' | 'error' | 'unknown';
export type DeploymentStatus = 'pending' | 'in_progress' | 'success' | 'failed' | 'rolled_back';

// ============================================================================
// Infrastructure Types
// ============================================================================

export interface Server {
  id: number;
  name: string;
  hostname: string | null;
  ip_addresses: string | null; // JSON array
  role: ServerRole | null;
  ssh_user: string;
  ssh_port: number;
  ssh_key_path: string | null;
  ssh_jump_host: string | null;
  os: string | null;
  resources: string | null; // JSON object
  tags: string | null; // JSON array
  status: ServerStatus;
  last_seen: string | null;
  last_health_check: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: number;
  name: string;
  server_id: number;
  type: string | null;
  runtime: string | null;
  port: number | null;
  health_endpoint: string | null;
  health_status: HealthStatus;
  last_health_check: string | null;
  response_time_ms: number | null;
  config: string | null; // JSON object
  env_file: string | null;
  project_path: string | null;
  git_repo: string | null;
  git_branch: string;
  current_version: string | null;
  deploy_command: string | null;
  restart_command: string | null;
  stop_command: string | null;
  log_command: string | null;
  status: ServiceStatus;
  auto_restart: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceWithDomain extends Service {
  primary_domain?: string;
  server_name?: string;
}

export interface Route {
  id: number;
  domain: string;
  path: string;
  service_id: number;
  method: string;
  proxy_type: string | null;
  ssl_type: string | null;
  rate_limit: string | null; // JSON object
  auth_required: number;
  notes: string | null;
  created_at: string;
}

export interface RouteWithService extends Route {
  service_name: string;
  server_name: string;
}

export interface ServiceDependency {
  id: number;
  service_id: number;
  depends_on_service_id: number | null;
  depends_on_external: string | null;
  dependency_type: string | null;
  connection_env_var: string | null;
  required: number;
  notes: string | null;
  created_at: string;
}

export interface Deployment {
  id: number;
  service_id: number;
  version: string;
  previous_version: string | null;
  deployed_by: string | null;
  deploy_method: string | null;
  status: DeploymentStatus;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  output: string | null;
  error: string | null;
  rollback_version: string | null;
  notes: string | null;
}

export interface InfraEvent {
  id: number;
  server_id: number | null;
  service_id: number | null;
  event_type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string | null;
  metadata: string | null; // JSON object
  created_at: string;
}

export interface InfraEventWithNames extends InfraEvent {
  server_name?: string;
  service_name?: string;
}

export interface ServerWithServices extends Server {
  services: ServiceWithDomain[];
}

export interface InfraStatus {
  servers: ServerWithServices[];
  summary: {
    total_servers: number;
    servers_online: number;
    total_services: number;
    services_healthy: number;
  };
}

// ============================================================================
// Project Types
// ============================================================================

export interface Project {
  id: number;
  path: string;
  name: string;
  type: string | null;
  stack: string | null; // JSON array
  status: 'active' | 'maintenance' | 'archived';
  created_at: string;
  updated_at: string;
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

export type FileType = 'component' | 'route' | 'util' | 'config' | 'schema' | 'service' | 'hook' | 'middleware' | 'test' | 'other';
export type FileStatus = 'active' | 'deprecated' | 'do-not-touch' | 'generated';

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
  type: 'code' | 'config' | 'doc' | 'other';
  size: number;
  content?: string;
}

export interface StaleFile {
  path: string;
  lastAnalyzed: string;
  fsModified: string;
  status: 'stale' | 'outdated' | 'missing';
  reason: string;
}

// ============================================================================
// Decision & Issue Types
// ============================================================================

export type DecisionStatus = 'active' | 'superseded' | 'reconsidering';

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
  decided_at: string;
  created_at: string;
}

export type IssueType = 'bug' | 'tech-debt' | 'enhancement' | 'question' | 'potential';
export type IssueStatus = 'open' | 'in-progress' | 'resolved' | 'wont-fix';

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

export type LearningCategory = 'pattern' | 'gotcha' | 'preference' | 'convention' | 'architecture';

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
// Tech Debt Types
// ============================================================================

export type DebtEffort = 'small' | 'medium' | 'large';
export type DebtStatus = 'open' | 'in-progress' | 'resolved';

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

// ============================================================================
// Query & Search Types
// ============================================================================

export type QueryResultType = 'file' | 'decision' | 'issue' | 'learning' | 'global-learning';

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

export type EmbeddingProvider = 'voyage' | 'disabled';

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
// Analysis Types
// ============================================================================

export interface AnalysisResult {
  project: {
    type: string;
    stack: string[];
    description: string;
  };
  files: Array<{
    path: string;
    type: string;
    purpose: string;
    fragility: number;
    fragility_reason?: string;
    exports?: string[];
    key_functions?: string[];
  }>;
  decisions: Array<{
    title: string;
    decision: string;
    reasoning: string;
    affects: string[];
  }>;
  architecture: {
    patterns: string[];
    entry_points: string[];
    data_flow?: string;
  };
  potential_issues: Array<{
    title: string;
    description: string;
    severity: number;
    affected_files: string[];
  }>;
  tech_debt?: Array<{
    title: string;
    description: string;
    severity: number;
    effort: string;
    affected_files: string[];
  }>;
}

// ============================================================================
// Ship Checklist Types
// ============================================================================

export type ShipCheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface ShipCheck {
  name: string;
  status: ShipCheckStatus;
  message?: string;
}

// ============================================================================
// Security Types
// ============================================================================

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SecurityFinding {
  type: string;
  severity: SecuritySeverity;
  line?: number;
  snippet?: string;
  description: string;
  recommendation: string;
}

export interface SecretFinding {
  type: string;
  line: number;
  snippet: string;
}

export interface AuditVulnerability {
  package: string;
  severity: string;
  title: string;
  url?: string;
  recommendation?: string;
}

// ============================================================================
// Quality Types
// ============================================================================

export interface QualityMetrics {
  cyclomaticComplexity: number;
  maxFunctionLength: number;
  functionCount: number;
  anyTypeCount: number;
  tsIgnoreCount: number;
  todoCount: number;
  lintErrors: number;
  lintWarnings: number;
  overallScore: number;
  issues: Array<{ type: string; message: string; line?: number }>;
}

// ============================================================================
// Performance Types
// ============================================================================

export type PerformanceSeverity = 'high' | 'medium' | 'low';

export interface PerformanceFinding {
  type: string;
  severity: PerformanceSeverity;
  line?: number;
  snippet?: string;
  description: string;
  recommendation: string;
}

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
}

export interface DriftResult {
  staleFiles: StaleFile[];
  gitChanges: string[];
  untrackedFiles: string[];
  recommendations: string[];
}

export type ProjectHealth = 'good' | 'attention' | 'critical';

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
// Growth Types
// ============================================================================

export interface GrowthScore {
  overall: number;
  shareability: number;
  networkEffects: number;
  virality: number;
  suggestions: string[];
}

// ============================================================================
// Code Review Types
// ============================================================================

export interface CodeReviewResult {
  summary: string;
  score: number;
  issues: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    line: number | null;
    issue: string;
    suggestion: string;
  }>;
  positives: string[];
  refactor_suggestions: string[];
}

// ============================================================================
// Configuration
// ============================================================================

export interface EliteStack {
  runtime: string;
  language: string;
  frontend: string[];
  backend: string[];
  database: string[];
  styling: string[];
  validation: string;
  testing: string[];
  deployment: string[];
}

export const ELITE_STACK: EliteStack = {
  runtime: "Bun",
  language: "TypeScript (strict)",
  frontend: ["SvelteKit", "Next.js 15", "Astro"],
  backend: ["Go", "Hono", "tRPC"],
  database: ["Drizzle", "SQLite/Turso", "PostgreSQL/Neon"],
  styling: ["Tailwind", "CVA"],
  validation: "Zod",
  testing: ["Vitest", "Playwright"],
  deployment: ["Vercel", "Cloudflare Workers", "Docker"],
};
