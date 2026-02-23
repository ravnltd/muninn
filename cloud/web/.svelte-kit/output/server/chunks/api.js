const API_BASE = "https://api.muninn.pro";
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
function getToken() {
  return localStorage.getItem("muninn_api_key");
}
function setToken(key) {
  localStorage.setItem("muninn_api_key", key);
}
function clearToken() {
  localStorage.removeItem("muninn_api_key");
}
async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...options.headers ?? {}
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? body.message ?? res.statusText);
  }
  if (res.status === 204) return void 0;
  return res.json();
}
const api = {
  // Auth (public)
  async signup(email, password, name) {
    const data = await request("/api/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, name })
    });
    setToken(data.apiKey);
    return data;
  },
  async login(email, password) {
    const data = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setToken(data.apiKey);
    return data;
  },
  logout() {
    clearToken();
    window.location.href = "/login";
  },
  isAuthenticated() {
    return getToken() !== null;
  },
  // Account
  getAccount: () => request("/api/account"),
  deleteAccount: () => request("/api/account", { method: "DELETE" }),
  deleteData: () => request("/api/delete-my-data", { method: "POST" }),
  exportData: () => request("/api/export"),
  // API Keys
  getKeys: () => request("/api/keys"),
  createKey: (name) => request("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name })
  }),
  revokeKey: (id) => request(`/api/keys/${id}`, { method: "DELETE" }),
  // Usage
  getUsage: () => request("/api/usage"),
  // Team
  getMembers: () => request("/api/team/members"),
  inviteMember: (email, role) => request("/api/team/invite", {
    method: "POST",
    body: JSON.stringify({ email, role })
  }),
  updateMemberRole: (userId, role) => request(`/api/team/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role })
  }),
  removeMember: (userId) => request(`/api/team/members/${userId}`, { method: "DELETE" }),
  getInvitations: () => request("/api/team/invitations"),
  revokeInvitation: (id) => request(`/api/team/invitations/${id}`, { method: "DELETE" }),
  // Billing
  createCheckout: () => request("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan: "pro" })
  }),
  openPortal: () => request("/api/billing/portal", { method: "POST" }),
  // Database (BYOD)
  setDatabase: (tursoDbUrl, tursoAuthToken) => request("/api/database", {
    method: "PUT",
    body: JSON.stringify({ tursoDbUrl, tursoAuthToken })
  }),
  // SSO
  getSsoConfig: () => request("/api/sso/config"),
  updateSsoConfig: (config) => request("/api/sso/config", {
    method: "PUT",
    body: JSON.stringify(config)
  }),
  deleteSsoConfig: () => request("/api/sso/config", { method: "DELETE" }),
  testSso: () => request("/api/sso/test", {
    method: "POST"
  }),
  // Knowledge Explorer
  getProjects: () => request("/api/knowledge/projects"),
  getProjectMemory: (projectId) => request(`/api/knowledge/projects/${projectId}/memory`),
  getProjectSessions: (projectId, limit = 50) => request(`/api/knowledge/projects/${projectId}/sessions?limit=${limit}`),
  getProjectGraph: (projectId) => request(`/api/knowledge/projects/${projectId}/graph`),
  getHealthScore: (projectId) => request(`/api/knowledge/health-score?project_id=${projectId}`),
  getRoiMetrics: (projectId) => request(`/api/knowledge/metrics/roi?project_id=${projectId}`),
  searchKnowledge: (projectId, query) => request(
    `/api/knowledge/projects/${projectId}/search?q=${encodeURIComponent(query)}`
  ),
  // Wave 3: Risk Alerts, Export, Archive
  getRiskAlerts: (projectId) => request(`/api/knowledge/risk-alerts?projectId=${projectId}`),
  exportMemory: (projectId) => request(`/api/knowledge/export/memory?projectId=${projectId}`),
  // v6 polish
  getProjectBriefing: (projectId, refresh = false) => request(`/api/knowledge/projects/${projectId}/briefing${refresh ? "?refresh=true" : ""}`),
  getHealthHistory: (projectId, limit = 30) => request(`/api/knowledge/health-score/history?project_id=${projectId}&limit=${limit}`),
  getArchivedKnowledge: (projectId) => request(`/api/knowledge/projects/${projectId}/archived`),
  restoreArchivedItem: (projectId, archivedId) => request(`/api/knowledge/projects/${projectId}/archived/${archivedId}/restore`, { method: "POST" }),
  getWebhookSettings: () => request("/api/settings/webhook"),
  setWebhookSettings: (webhookUrl, webhookSecret) => request("/api/settings/webhook", {
    method: "PUT",
    body: JSON.stringify({ webhookUrl, webhookSecret })
  })
};
export {
  ApiError as A,
  api as a
};
