export type Plan = 'free' | 'pro' | 'team';
export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface Tenant {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
}

export interface UsageInfo {
  toolCallCount: number;
  limit: number;
  month: string;
}

export interface AccountResponse {
  tenant: Tenant;
  usage: UsageInfo;
}

export interface LoginResponse {
  tenant: Tenant;
  apiKey: string;
}

export interface SignupResponse {
  tenant: Tenant;
  apiKey: string;
  setup: {
    command: string;
    note: string;
  };
}

export interface ApiKeyRecord {
  id: string;
  prefix: string;
  name: string | null;
  createdAt: string;
}

export interface ApiKeyCreated extends ApiKeyRecord {
  key: string;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: string;
  metadata?: unknown;
}

export interface SsoConfig {
  configured: boolean;
  provider?: 'saml' | 'oidc';
  entityId?: string;
  ssoUrl?: string;
  sloUrl?: string;
  hasCertificate?: boolean;
  oidcIssuer?: string;
  oidcClientId?: string;
  domain?: string;
  enforceSso?: boolean;
  allowPasswordFallback?: boolean;
}

// Knowledge Explorer types
export interface Project {
  id: number;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface FileInfo {
  id: number;
  path: string;
  purpose: string | null;
  type: string | null;
  fragility: number;
  fragility_signals: string | null;
  temperature: string | null;
  change_count: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionInfo {
  id: number;
  title: string;
  decision: string;
  reasoning: string | null;
  status: string;
  outcome: string | null;
  temperature: string | null;
  created_at: string;
  updated_at: string;
}

export interface LearningInfo {
  id: number;
  title: string;
  content: string;
  category: string;
  context: string | null;
  confidence: number;
  temperature: string | null;
  auto_reinforcement_count: number;
  created_at: string;
  updated_at: string;
}

export interface IssueInfo {
  id: number;
  title: string;
  description: string | null;
  type: string | null;
  severity: number;
  status: string;
  resolution: string | null;
  workaround: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionInfo {
  id: number;
  session_number: number | null;
  goal: string | null;
  outcome: string | null;
  success: number | null;
  files_touched: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  temperature?: string | null;
  fragility?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface HealthScoreComponent {
  name: string;
  score: number;
  weight: number;
  details: string;
}

export interface HealthScore {
  overall: number;
  components: HealthScoreComponent[];
  computedAt: string;
}

export interface RoiMetrics {
  month: string;
  contradictionsPrevented: number;
  contextInjections: number;
  contextHitRate: number;
  decisionsRecalled: number;
  learningsApplied: number;
  sessionsWithContext: number;
  totalSessions: number;
}

export interface KnowledgeMemory {
  files: FileInfo[];
  decisions: DecisionInfo[];
  learnings: LearningInfo[];
  issues: IssueInfo[];
}

export interface RiskAlert {
  id: number;
  alert_type: string;
  severity: string;
  title: string;
  details: string | null;
  source_file: string | null;
  created_at: string;
}

export interface ExportedMemory {
  exportedAt: string;
  projectId: number;
  files: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  learnings: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  archived: Array<Record<string, unknown>>;
}

export interface MonthlyReport {
  month: string;
  healthScore: HealthScore | null;
  roi: RoiMetrics | null;
  riskAlerts: RiskAlert[];
  memoryCounts: {
    files: number;
    decisions: number;
    learnings: number;
    issues: number;
  };
}
