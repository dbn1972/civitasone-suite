-- Migration: 0017_org_masterdata_rls.sql
-- Purpose: Close the RLS gap left by 0015 — org_units, data_migrations and
--          reconciliations were created WITHOUT row-level security, so tenant
--          isolation was enforced only by app-layer WHERE clauses (fragile).
--          Also adds generic effective-dating columns to org_units (CAP-018).
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table; DISABLE ROW LEVEL SECURITY.
SET lock_timeout = '5s';

-- current_tenant_id() is defined in 0002/0010; ensure it exists (idempotent).
CREATE OR REPLACE FUNCTION tenant.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- CAP-018: effective-dating on org_units (versioned masters).
ALTER TABLE tenant.org_units ADD COLUMN IF NOT EXISTS effective_from timestamptz NOT NULL DEFAULT now();
ALTER TABLE tenant.org_units ADD COLUMN IF NOT EXISTS effective_to   timestamptz;

-- A unit code must be unique per tenant among currently-effective rows (partial
-- unique index ignores rows that have been logically closed).
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_units_tenant_code_active
  ON tenant.org_units (tenant_id, code)
  WHERE code IS NOT NULL AND effective_to IS NULL;

-- ── RLS: org_units ────────────────────────────────────────────────────
ALTER TABLE tenant.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.org_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.org_units;
CREATE POLICY tenant_isolation_policy ON tenant.org_units
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- ── RLS: data_migrations ──────────────────────────────────────────────
ALTER TABLE tenant.data_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.data_migrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.data_migrations;
CREATE POLICY tenant_isolation_policy ON tenant.data_migrations
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- ── RLS: reconciliations ──────────────────────────────────────────────
ALTER TABLE tenant.reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.reconciliations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.reconciliations;
CREATE POLICY tenant_isolation_policy ON tenant.reconciliations
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());
