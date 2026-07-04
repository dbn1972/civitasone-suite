-- 0021_rls_completion_g1.sql
-- G1 RLS Completion: Enable row-level security on perquisite_components
-- table (from 0012_p1_challan_taxcfg_perq_26q.sql) which was missed by
-- previous RLS migrations (0015, 0017, 0020).
-- Idempotent: uses DROP POLICY IF EXISTS before CREATE POLICY.
-- Uses the current_tenant_id() NULL-returning pattern established in 0015.

BEGIN;

-- payroll.perquisite_components (from 0012)
ALTER TABLE payroll.perquisite_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.perquisite_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.perquisite_components;
CREATE POLICY tenant_isolation ON payroll.perquisite_components
  USING (tenant_id = payroll.current_tenant_id());

COMMIT;
