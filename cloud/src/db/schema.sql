-- Muninn Cloud Management Database Schema
-- Stores tenant metadata, auth, and billing. NOT customer data.

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tenant databases (managed or BYOD)
CREATE TABLE IF NOT EXISTS tenant_databases (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'managed',
  turso_db_name TEXT,
  turso_db_url TEXT NOT NULL,
  turso_auth_token TEXT NOT NULL,
  export_token TEXT,
  schema_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT,
  scopes TEXT NOT NULL DEFAULT '["mcp:tools"]',
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- OAuth Clients (Dynamic Client Registration)
-- Note: No ON DELETE CASCADE for tenant_id — intentional.
-- Cleanup handled by deleteTenant() in tenants/manager.ts:157-161.
-- SQLite cannot ALTER existing constraints, so migration is not worth the risk.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_secret_expires_at INTEGER,
  tenant_id TEXT REFERENCES tenants(id),
  redirect_uris TEXT NOT NULL,
  client_name TEXT,
  grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OAuth Authorization Codes (short-lived)
CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method TEXT,
  scopes TEXT,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OAuth Access/Refresh Tokens
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  token_type TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  scopes TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_tenant ON oauth_tokens(tenant_id);

-- Usage Metering
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL,
  query_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant_month ON usage(tenant_id, month);

-- Audit Log (immutable trail for security-relevant actions)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(tenant_id, action);

-- Rate Limit State (cross-instance persistence)
CREATE TABLE IF NOT EXISTS rate_limit_state (
  key TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  tokens REAL NOT NULL,
  last_refill_ms INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key, instance_id)
);

-- Rate Limit Violations (audit trail)
CREATE TABLE IF NOT EXISTS rate_limit_violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  plan TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Users (RBAC)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(tenant_id, email);

-- Invitations (team member invites)
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token_hash);

-- SSO Configs
CREATE TABLE IF NOT EXISTS sso_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'saml',
  entity_id TEXT,
  sso_url TEXT,
  slo_url TEXT,
  certificate_pem TEXT,
  oidc_issuer TEXT,
  oidc_client_id TEXT,
  oidc_client_secret_encrypted TEXT,
  domain TEXT,
  enforce_sso INTEGER NOT NULL DEFAULT 0,
  allow_password_fallback INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SAML Relay State (stores OAuth params during SSO redirect)
CREATE TABLE IF NOT EXISTS saml_relay_state (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  client_id TEXT,
  redirect_uri TEXT,
  code_challenge TEXT,
  state TEXT,
  scope TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
