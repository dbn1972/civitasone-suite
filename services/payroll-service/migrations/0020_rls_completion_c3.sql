-- 0020_rls_completion_c3.sql
-- C3 RLS Completion: Enable row-level security on all remaining tables
-- that were introduced after the initial RLS migration (0015).
-- Idempotent: uses DROP POLICY IF EXISTS before CREATE POLICY.

BEGIN;

-- ============================================================
-- Schema: payroll
-- ============================================================

-- payroll.payroll_register (from 0005)
ALTER TABLE payroll.payroll_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_register FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_register;
CREATE POLICY tenant_isolation ON payroll.payroll_register USING (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_arrears (from 0005)
ALTER TABLE payroll.payroll_arrears ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_arrears FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_arrears;
CREATE POLICY tenant_isolation ON payroll.payroll_arrears USING (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_bonus (from 0005)
ALTER TABLE payroll.payroll_bonus ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_bonus FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_bonus;
CREATE POLICY tenant_isolation ON payroll.payroll_bonus USING (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_tax_declarations (from 0004)
ALTER TABLE payroll.payroll_tax_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_tax_declarations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_tax_declarations;
CREATE POLICY tenant_isolation ON payroll.payroll_tax_declarations USING (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_professional_tax (from 0005)
ALTER TABLE payroll.payroll_professional_tax ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_professional_tax FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_professional_tax;
CREATE POLICY tenant_isolation ON payroll.payroll_professional_tax USING (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_lwf (from 0005)
ALTER TABLE payroll.payroll_lwf ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_lwf FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_lwf;
CREATE POLICY tenant_isolation ON payroll.payroll_lwf USING (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_reimbursements (from 0005)
ALTER TABLE payroll.payroll_reimbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_reimbursements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_reimbursements;
CREATE POLICY tenant_isolation ON payroll.payroll_reimbursements USING (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_salary_revisions (from 0005)
ALTER TABLE payroll.payroll_salary_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_salary_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_salary_revisions;
CREATE POLICY tenant_isolation ON payroll.payroll_salary_revisions USING (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_ctc_config (from 0005)
ALTER TABLE payroll.payroll_ctc_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_ctc_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_ctc_config;
CREATE POLICY tenant_isolation ON payroll.payroll_ctc_config USING (tenant_id = payroll.current_tenant_id());

-- ============================================================
-- Schema: statutory
-- ============================================================

-- statutory.payroll_gratuity (from 0001)
ALTER TABLE statutory.payroll_gratuity ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_gratuity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_gratuity;
CREATE POLICY tenant_isolation ON statutory.payroll_gratuity USING (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_tds_challan (from 0012)
ALTER TABLE statutory.payroll_tds_challan ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_tds_challan FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_tds_challan;
CREATE POLICY tenant_isolation ON statutory.payroll_tds_challan USING (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_tds_nonsalary (from 0012)
ALTER TABLE statutory.payroll_tds_nonsalary ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_tds_nonsalary FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_tds_nonsalary;
CREATE POLICY tenant_isolation ON statutory.payroll_tds_nonsalary USING (tenant_id = payroll.current_tenant_id());

COMMIT;
