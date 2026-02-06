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
