-- Muninn Memory API — PostgreSQL Schema
-- Requires: pgvector extension, pg_trgm extension

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Tenants
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Registered Apps
-- ============================================================================

CREATE TABLE IF NOT EXISTS apps (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id)
);

-- ============================================================================
-- Custom Type Definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_types (
  id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  base_type TEXT NOT NULL,
  schema JSONB,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, app_id, id),
  FOREIGN KEY (tenant_id, app_id) REFERENCES apps(tenant_id, id) ON DELETE CASCADE
);

-- ============================================================================
-- Unified Memory Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  scope TEXT NOT NULL,

  -- Classification
  type TEXT NOT NULL,
  subtype TEXT,

  -- Content
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Confidence & provenance
  confidence REAL NOT NULL DEFAULT 0.7
    CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL DEFAULT 'user'
    CHECK (source IN ('user', 'extracted', 'inferred', 'imported', 'system')),

  -- Temporal validity
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  superseded_by UUID REFERENCES memories(id),

  -- Vector embedding (Voyage AI voyage-3-lite, 512 dimensions)
  embedding vector(512),

  -- Categorization
  tags TEXT[] NOT NULL DEFAULT '{}',

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mem_tenant_app ON memories(tenant_id, app_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mem_scope ON memories(tenant_id, app_id, scope)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mem_type ON memories(tenant_id, type)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mem_subtype ON memories(tenant_id, type, subtype)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mem_tags ON memories USING GIN(tags)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mem_metadata ON memories USING GIN(metadata)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mem_valid ON memories(valid_from, valid_until)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_mem_content_trgm ON memories USING GIN(content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mem_title_trgm ON memories USING GIN(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at DESC)
  WHERE deleted_at IS NULL;

-- Full-text search column
ALTER TABLE memories ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_mem_fts ON memories USING GIN(fts);

-- HNSW vector index (created after table exists)
CREATE INDEX IF NOT EXISTS idx_mem_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Memory Relations
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5
    CHECK (strength >= 0 AND strength <= 1),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, target_id, relation)
);

-- ============================================================================
-- Cross-App Permissions
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_grants (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  granting_app TEXT NOT NULL,
  granted_app TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'read'
    CHECK (permission IN ('read', 'context')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, granting_app, granted_app)
);

-- ============================================================================
-- Context Request Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS context_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  memories_returned UUID[],
  total_candidates INTEGER,
  token_count INTEGER,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ctx_log_tenant ON context_log(tenant_id, created_at DESC);
