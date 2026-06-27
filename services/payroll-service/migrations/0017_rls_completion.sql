-- 0017_rls_completion.sql
-- Purpose: Extend RLS tenant isolation to all payroll tables that were absent
--          from 0015_rls_tenant_isolation.sql:
--            payroll schema   — payroll_structures, payroll_components,
--                               payroll_ddos, payroll_ddo_departments,
--                               payroll_pensioners
--            statutory schema — payroll_esi, payroll_gpf, payroll_nps
--                               (payroll_pf and payroll_tds were covered in 0015)
--
-- Uses the same payroll.current_tenant_id() helper created in 0015.
-- Additive + idempotent only — no DROP TABLE, no data changes.

-- ── payroll.payroll_structures ────────────────────────────────────
ALTER TABLE payroll.payroll_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_structures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_structures;
CREATE POLICY tenant_isolation ON payroll.payroll_structures
  USING (tenant_id = payroll.current_tenant_id());

-- ── payroll.payroll_components ────────────────────────────────────
ALTER TABLE payroll.payroll_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_components;
CREATE POLICY tenant_isolation ON payroll.payroll_components
  USING (tenant_id = payroll.current_tenant_id());

-- ── payroll.payroll_ddos ──────────────────────────────────────────
ALTER TABLE payroll.payroll_ddos ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_ddos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_ddos;
CREATE POLICY tenant_isolation ON payroll.payroll_ddos
  USING (tenant_id = payroll.current_tenant_id());

-- ── payroll.payroll_ddo_departments ──────────────────────────────
ALTER TABLE payroll.payroll_ddo_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_ddo_departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_ddo_departments;
CREATE POLICY tenant_isolation ON payroll.payroll_ddo_departments
  USING (tenant_id = payroll.current_tenant_id());

-- ── payroll.payroll_pensioners ────────────────────────────────────
ALTER TABLE payroll.payroll_pensioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_pensioners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_pensioners;
CREATE POLICY tenant_isolation ON payroll.payroll_pensioners
  USING (tenant_id = payroll.current_tenant_id());

-- ── statutory.payroll_esi ─────────────────────────────────────────
-- NOTE: payroll_esi was defined in 0001_init.sql but omitted from 0015.
ALTER TABLE statutory.payroll_esi ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_esi FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_esi;
CREATE POLICY tenant_isolation ON statutory.payroll_esi
  USING (tenant_id = payroll.current_tenant_id());

-- ── statutory.payroll_gpf ─────────────────────────────────────────
-- NOTE: payroll_gpf was created in 0005_gpf_nps.sql but omitted from 0015.
ALTER TABLE statutory.payroll_gpf ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_gpf FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_gpf;
CREATE POLICY tenant_isolation ON statutory.payroll_gpf
  USING (tenant_id = payroll.current_tenant_id());

-- ── statutory.payroll_nps ─────────────────────────────────────────
-- NOTE: payroll_nps was created in 0005_gpf_nps.sql but omitted from 0015.
ALTER TABLE statutory.payroll_nps ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_nps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_nps;
CREATE POLICY tenant_isolation ON statutory.payroll_nps
  USING (tenant_id = payroll.current_tenant_id());
