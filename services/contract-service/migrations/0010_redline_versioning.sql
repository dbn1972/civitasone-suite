-- Migration: 0010_redline_versioning.sql
-- Purpose: Add contract versioning and redline tracking tables for CLM Icertis parity.
-- Rollback: DROP TABLE IF EXISTS versions.redlines; DROP TABLE IF EXISTS versions.contract_versions; DROP SCHEMA IF EXISTS versions;
-- Affected services: contract-service

SET lock_timeout = '5s';

-- Create the versions schema
CREATE SCHEMA IF NOT EXISTS versions;

-- Contract versions table: stores content snapshots
CREATE TABLE IF NOT EXISTS versions.contract_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  contract_id    UUID NOT NULL,
  version_number INTEGER NOT NULL,
  content        TEXT NOT NULL,
  created_by     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_contract_version UNIQUE (contract_id, tenant_id, version_number),
  CONSTRAINT chk_version_number CHECK (version_number >= 1 AND version_number <= 100)
);

-- Redlines table: tracks insertions/deletions per version
CREATE TABLE IF NOT EXISTS versions.redlines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  contract_id    UUID NOT NULL,
  version_number INTEGER NOT NULL,
  position       INTEGER NOT NULL,
  type           VARCHAR(10) NOT NULL,
  content        TEXT NOT NULL,
  actor          UUID NOT NULL,
  "timestamp"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_redline_type CHECK (type IN ('insert', 'delete')),
  CONSTRAINT chk_redline_version CHECK (version_number >= 1 AND version_number <= 100)
);

-- Enable RLS on both tables
ALTER TABLE versions.contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions.contract_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE versions.redlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions.redlines FORCE ROW LEVEL SECURITY;

-- Tenant isolation policies
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'contract_versions' AND schemaname = 'versions' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON versions.contract_versions
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'redlines' AND schemaname = 'versions' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON versions.redlines
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

-- Indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_versions_contract_tenant
  ON versions.contract_versions (contract_id, tenant_id, version_number);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_redlines_contract_version
  ON versions.redlines (contract_id, tenant_id, version_number);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_redlines_actor
  ON versions.redlines (actor);
