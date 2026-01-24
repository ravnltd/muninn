/**
 * API client for the Muninn dashboard
 */

const BASE_URL = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
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
