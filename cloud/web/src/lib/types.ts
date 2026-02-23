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
