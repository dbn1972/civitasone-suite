-- Migration: 0032_sec010_reconciliation_rls.sql
-- Purpose: SEC-010 -- admin.reconciliation_results and admin.reconciliation_breaks
--          (0020_reconciliation_results.sql) were created after admin-service's RLS
--          isolation sweep (0006_rls_full_tenant_isolation.sql) and never got row-level
--          security at all -- not even ENABLE.
-- RLS: full tenant isolation, mirroring 0029_sftp_lead_ingestion.sql (ENABLE + FORCE +
--      current_tenant_id() USING/WITH CHECK). admin_svc owns these tables (per-service
--      migrations run as the service role by default), so FORCE is required for the
--      policy to actually apply to it, not just ENABLE.
-- App-layer check: src/modules/reconciliation-consumer.ts already writes both tables
-- through db.transaction()/tx.execute(), which sets app.tenant_id via
-- wrapWithTenantGuc -- no companion code change needed, no regression expected.
-- Additive + idempotent. Safe to re-run.
-- Rollback: ALTER TABLE admin.reconciliation_results DISABLE ROW LEVEL SECURITY;
--           ALTER TABLE admin.reconciliation_breaks DISABLE ROW LEVEL SECURITY;
--           DROP POLICY tenant_isolation_policy ON admin.reconciliation_results;
--           DROP POLICY tenant_isolation_policy ON admin.reconciliation_breaks;
-- Affected services: admin-service

SET lock_timeout = '5s';

-- current_tenant_id() is created by earlier migrations (0006/0013/0014); guard
-- so this migration never needs to own it (mirrors 0029_sftp_lead_ingestion.sql).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

-- ── admin.reconciliation_results ─────────────────────────────────────────────
ALTER TABLE admin.reconciliation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.reconciliation_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON admin.reconciliation_results;
DROP POLICY IF EXISTS tenant_isolation ON admin.reconciliation_results;
CREATE POLICY tenant_isolation_policy ON admin.reconciliation_results
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── admin.reconciliation_breaks ───────────────────────────────────────────────
ALTER TABLE admin.reconciliation_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.reconciliation_breaks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON admin.reconciliation_breaks;
DROP POLICY IF EXISTS tenant_isolation ON admin.reconciliation_breaks;
CREATE POLICY tenant_isolation_policy ON admin.reconciliation_breaks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
