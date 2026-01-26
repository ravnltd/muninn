/**
 * API client for the Muninn dashboard
 */

const BASE_URL = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new Error(`Network error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`API error ${response.status}: ${body || response.statusText}`);
  }
  return response.json();
}

async function postJson<T>(path: string, data: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error: ${response.status}`);
  }
  return response.json();
}

async function putJson<T>(path: string, data: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error: ${response.status}`);
  }
  return response.json();
}

export interface ProjectInfo {
  id: number;
  name: string;
  path: string;
  status: string;
  mode: string;
}

export interface FileInfo {
  id: number;
  path: string;
  purpose: string | null;
  fragility: number;
  temperature: string | null;
  archived_at: string | null;
  velocity_score: number;
}

export interface DecisionInfo {
  id: number;
  title: string;
  decision: string;
  status: string;
  temperature: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface IssueInfo {
  id: number;
  title: string;
  description: string | null;
  severity: number;
  status: string;
  type: string;
  temperature: string | null;
  created_at: string;
}

export interface LearningInfo {
  id: number;
  title: string;
  content: string;
  category: string;
  temperature: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface SessionInfo {
  id: number;
  goal: string | null;
  outcome: string | null;
  started_at: string;
  ended_at: string | null;
  success: number | null;
  session_number: number | null;
  files_touched: string | null;
}

export interface RelationshipInfo {
  id: number;
  source_type: string;
  source_id: number;
  target_type: string;
  target_id: number;
  relationship: string;
  strength: number;
}

export interface HealthData {
  project: ProjectInfo;
  fileCount: number;
  openIssues: number;
  activeDecisions: number;
  fragileFiles: FileInfo[];
  recentSessions: SessionInfo[];
  techDebtScore: number;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  size: number;
  temperature?: string;
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

export interface MemoryData {
  files: FileInfo[];
  decisions: DecisionInfo[];
  issues: IssueInfo[];
  learnings: LearningInfo[];
}

// ============================================================================
// API Functions
// ============================================================================

export async function getProjects(): Promise<ProjectInfo[]> {
  return fetchJson<ProjectInfo[]>("/projects");
}

export async function getHealth(projectId: number): Promise<HealthData> {
  return fetchJson<HealthData>(`/projects/${projectId}/health`);
}

export async function getFiles(projectId: number): Promise<FileInfo[]> {
  return fetchJson<FileInfo[]>(`/projects/${projectId}/files`);
}

export async function getDecisions(projectId: number): Promise<DecisionInfo[]> {
  return fetchJson<DecisionInfo[]>(`/projects/${projectId}/decisions`);
}

export async function getIssues(projectId: number): Promise<IssueInfo[]> {
  return fetchJson<IssueInfo[]>(`/projects/${projectId}/issues`);
}

export async function getLearnings(projectId: number): Promise<LearningInfo[]> {
  return fetchJson<LearningInfo[]>(`/projects/${projectId}/learnings`);
}

export async function getMemory(projectId: number, limit = 100): Promise<MemoryData> {
  if (!projectId || typeof projectId !== 'number') {
    throw new Error(`Invalid projectId: ${projectId}`);
  }
  return fetchJson<MemoryData>(`/projects/${projectId}/memory?limit=${limit}`);
}

export async function getSessions(projectId: number): Promise<SessionInfo[]> {
  return fetchJson<SessionInfo[]>(`/projects/${projectId}/sessions`);
}

export async function getRelationships(projectId: number): Promise<RelationshipInfo[]> {
  return fetchJson<RelationshipInfo[]>(`/projects/${projectId}/relationships`);
}

export async function getGraph(projectId: number): Promise<GraphData> {
  return fetchJson<GraphData>(`/projects/${projectId}/graph`);
}

export async function search(query: string, projectId?: number): Promise<unknown[]> {
  const params = new URLSearchParams({ q: query });
  if (projectId) params.set("project_id", String(projectId));
  return fetchJson<unknown[]>(`/search?${params}`);
}

// ============================================================================
// Mutation Input Types
// ============================================================================

export interface CreateIssueInput {
  title: string;
  description?: string;
  type?: "bug" | "tech-debt" | "enhancement" | "question" | "potential";
  severity?: number;
  workaround?: string;
}

export interface CreateDecisionInput {
  title: string;
  decision: string;
  reasoning?: string;
}

export interface CreateLearningInput {
  title: string;
  content: string;
  category?: "pattern" | "gotcha" | "preference" | "convention" | "architecture";
  context?: string;
}

// ============================================================================
// Mutation Functions
// ============================================================================

export async function createIssue(projectId: number, data: CreateIssueInput): Promise<{ id: number }> {
  return postJson(`/projects/${projectId}/issues`, data);
}

export async function resolveIssue(projectId: number, issueId: number, resolution: string): Promise<void> {
  return putJson(`/projects/${projectId}/issues/${issueId}/resolve`, { resolution });
}

export async function createDecision(projectId: number, data: CreateDecisionInput): Promise<{ id: number }> {
  return postJson(`/projects/${projectId}/decisions`, data);
}

export async function createLearning(projectId: number, data: CreateLearningInput): Promise<{ id: number }> {
  return postJson(`/projects/${projectId}/learnings`, data);
}
