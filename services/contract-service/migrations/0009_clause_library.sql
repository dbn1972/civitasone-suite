-- Purpose: Create clause_library table for the contract clause library feature.
-- Rollback: DROP TABLE IF EXISTS clauses.clause_library; DROP SCHEMA IF EXISTS clauses;
-- Affected services: contract-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS clauses;

CREATE TABLE IF NOT EXISTS clauses.clause_library (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  title       TEXT NOT NULL,
  category    VARCHAR(100) NOT NULL,
  jurisdiction VARCHAR(100) NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  body        TEXT NOT NULL,
  merge_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,

  CONSTRAINT clause_library_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT clause_library_body_length CHECK (length(body) <= 50000)
);

-- Indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clause_library_tenant_id
  ON clauses.clause_library (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clause_library_tenant_status
  ON clauses.clause_library (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clause_library_tenant_category
  ON clauses.clause_library (tenant_id, category);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clause_library_tenant_jurisdiction
  ON clauses.clause_library (tenant_id, jurisdiction);

-- RLS enforcement
ALTER TABLE clauses.clause_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE clauses.clause_library FORCE ROW LEVEL SECURITY;

-- Helper function matching the pattern used by other schemas in this DB
CREATE OR REPLACE FUNCTION clauses.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE POLICY tenant_isolation ON clauses.clause_library
  USING (tenant_id = clauses.current_tenant_id())
  WITH CHECK (tenant_id = clauses.current_tenant_id());
