-- Migration: 0018_masterdata_bulk.sql
-- Purpose: CAP-020 — make bulk import/export REAL. Previously the import
--          consumer only logged ("drops records") and export produced nothing.
--          These tables record every batch's outcome (per-record error report)
--          and every export's materialised payload, so the async jobs persist
--          real results that the status routes read back.
-- Additive + idempotent. RLS FORCED (tenant isolation).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenant.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS tenant.import_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  entity_type  varchar(64) NOT NULL,
  status       varchar(24) NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','processing','completed','failed')),
  total        int NOT NULL DEFAULT 0,
  inserted     int NOT NULL DEFAULT 0,
  failed       int NOT NULL DEFAULT 0,
  errors       jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by   uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_batches_tenant ON tenant.import_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.export_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  entity_type  varchar(64) NOT NULL,
  format       varchar(8) NOT NULL DEFAULT 'json'
                 CHECK (format IN ('json','csv')),
  status       varchar(24) NOT NULL DEFAULT 'generating'
                 CHECK (status IN ('generating','completed','failed')),
  record_count int NOT NULL DEFAULT 0,
  payload      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by   uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant ON tenant.export_jobs (tenant_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE tenant.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.import_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.import_batches;
CREATE POLICY tenant_isolation_policy ON tenant.import_batches
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

ALTER TABLE tenant.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.export_jobs;
CREATE POLICY tenant_isolation_policy ON tenant.export_jobs
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());
