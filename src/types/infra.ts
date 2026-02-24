/**
 * Infrastructure types — Server, Service, Route, Deployment
 */

// ============================================================================
// Server Roles & Status
// ============================================================================

export type ServerRole = "production" | "staging" | "homelab" | "development";
export type ServerStatus = "online" | "offline" | "degraded" | "unknown";
export type HealthStatus = "healthy" | "unhealthy" | "degraded" | "unknown";
export type ServiceStatus = "running" | "stopped" | "error" | "unknown";
export type DeploymentStatus = "pending" | "in_progress" | "success" | "failed" | "rolled_back";

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
  severity: "info" | "warning" | "error" | "critical";
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
