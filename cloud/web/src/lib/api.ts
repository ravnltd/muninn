import type {
  AccountResponse,
  ApiKeyCreated,
  ApiKeyRecord,
  ArchivedItem,
  ExportedMemory,
  GraphData,
  HealthScore,
  HealthScoreHistoryPoint,
  Invitation,
  KnowledgeMemory,
  LoginResponse,
  Project,
  ProjectBriefing,
  RiskAlert,
  RoiMetrics,
  SessionInfo,
  SignupResponse,
  SsoConfig,
  TeamMember,
  UsageInfo,
  WebhookSettings
} from './types';

const API_BASE = import.meta.env.DEV ? '' : 'https://api.muninn.pro';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  return localStorage.getItem('muninn_api_key');
}

function setToken(key: string): void {
  localStorage.setItem('muninn_api_key', key);
}

function clearToken(): void {
  localStorage.removeItem('muninn_api_key');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? body.message ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Auth (public)
  async signup(email: string, password: string, name?: string): Promise<SignupResponse> {
    const data = await request<SignupResponse>('/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
    });
    setToken(data.apiKey);
    return data;
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    const data = await request<LoginResponse>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setToken(data.apiKey);
    return data;
  },

  logout(): void {
    clearToken();
    window.location.href = '/login';
  },

  isAuthenticated(): boolean {
    return getToken() !== null;
  },

  // Account
  getAccount: () => request<AccountResponse>('/api/account'),

  deleteAccount: () =>
    request<{ success: boolean }>('/api/account', { method: 'DELETE' }),

  deleteData: () =>
    request<{ success: boolean; message: string }>('/api/delete-my-data', { method: 'POST' }),

  exportData: () => request<unknown>('/api/export'),

  // API Keys
  getKeys: () =>
    request<{ keys: ApiKeyRecord[] }>('/api/keys'),

  createKey: (name?: string) =>
    request<ApiKeyCreated>('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name })
    }),

  revokeKey: (id: string) =>
    request<{ success: boolean }>(`/api/keys/${id}`, { method: 'DELETE' }),

  // Usage
  getUsage: () => request<UsageInfo>('/api/usage'),

  // Team
  getMembers: () =>
    request<{ members: TeamMember[] }>('/api/team/members'),

  inviteMember: (email: string, role?: string) =>
    request<{ invitation: Invitation; inviteToken: string }>('/api/team/invite', {
      method: 'POST',
      body: JSON.stringify({ email, role })
    }),

  updateMemberRole: (userId: string, role: string) =>
    request<{ success: boolean }>(`/api/team/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    }),

  removeMember: (userId: string) =>
    request<{ success: boolean }>(`/api/team/members/${userId}`, { method: 'DELETE' }),

  getInvitations: () =>
    request<{ invitations: Invitation[] }>('/api/team/invitations'),

  revokeInvitation: (id: string) =>
    request<{ success: boolean }>(`/api/team/invitations/${id}`, { method: 'DELETE' }),

  // Billing
  createCheckout: () =>
    request<{ url: string }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan: 'pro' })
    }),

  openPortal: () =>
    request<{ url: string }>('/api/billing/portal', { method: 'POST' }),

  // Database (BYOD)
  setDatabase: (tursoDbUrl: string, tursoAuthToken: string) =>
    request<{ success: boolean; mode: string }>('/api/database', {
      method: 'PUT',
      body: JSON.stringify({ tursoDbUrl, tursoAuthToken })
    }),

  // SSO
  getSsoConfig: () => request<SsoConfig>('/api/sso/config'),

  updateSsoConfig: (config: Record<string, unknown>) =>
    request<{ success: boolean; provider: string }>('/api/sso/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    }),

  deleteSsoConfig: () =>
    request<{ success: boolean }>('/api/sso/config', { method: 'DELETE' }),

  testSso: () =>
    request<{ valid: boolean; issues: string[]; provider: string }>('/api/sso/test', {
      method: 'POST'
    }),

  // Knowledge Explorer
  getProjects: () =>
    request<{ projects: Project[] }>('/api/knowledge/projects'),

  getProjectMemory: (projectId: number) =>
    request<KnowledgeMemory>(`/api/knowledge/projects/${projectId}/memory`),

  getProjectSessions: (projectId: number, limit = 50) =>
    request<{ sessions: SessionInfo[] }>(`/api/knowledge/projects/${projectId}/sessions?limit=${limit}`),

  getProjectGraph: (projectId: number) =>
    request<GraphData>(`/api/knowledge/projects/${projectId}/graph`),

  getHealthScore: (projectId: number) =>
    request<HealthScore>(`/api/knowledge/health-score?project_id=${projectId}`),

  getRoiMetrics: (projectId: number) =>
    request<RoiMetrics>(`/api/knowledge/metrics/roi?project_id=${projectId}`),

  searchKnowledge: (projectId: number, query: string) =>
    request<{ results: Array<{ type: string; id: number; title: string; snippet: string; score: number }> }>(
      `/api/knowledge/projects/${projectId}/search?q=${encodeURIComponent(query)}`
    ),

  // Wave 3: Risk Alerts, Export, Archive
  getRiskAlerts: (projectId: number) =>
    request<{ alerts: RiskAlert[] }>(`/api/knowledge/risk-alerts?projectId=${projectId}`),

  exportMemory: (projectId: number) =>
    request<ExportedMemory>(`/api/knowledge/export/memory?projectId=${projectId}`),

  // v6 polish
  getProjectBriefing: (projectId: number, refresh = false) =>
    request<ProjectBriefing>(`/api/knowledge/projects/${projectId}/briefing${refresh ? '?refresh=true' : ''}`),

  getHealthHistory: (projectId: number, limit = 30) =>
    request<{ history: HealthScoreHistoryPoint[] }>(`/api/knowledge/health-score/history?project_id=${projectId}&limit=${limit}`),

  getArchivedKnowledge: (projectId: number) =>
    request<{ archived: ArchivedItem[] }>(`/api/knowledge/projects/${projectId}/archived`),

  restoreArchivedItem: (projectId: number, archivedId: number) =>
    request<{ restored: boolean }>(`/api/knowledge/projects/${projectId}/archived/${archivedId}/restore`, { method: 'POST' }),

  getWebhookSettings: () =>
    request<WebhookSettings>('/api/settings/webhook'),

  setWebhookSettings: (webhookUrl: string, webhookSecret: string) =>
    request<{ success: boolean }>('/api/settings/webhook', {
      method: 'PUT',
      body: JSON.stringify({ webhookUrl, webhookSecret })
    })
};

export { ApiError };
