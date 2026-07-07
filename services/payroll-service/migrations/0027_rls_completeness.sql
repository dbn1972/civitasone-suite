-- RLS completeness: cover tables added after 0026_rls_full_tenant_isolation.sql
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy for 10 tables
--          created in later migrations that were missed by the full RLS pass.
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- payroll.costing_rules
ALTER TABLE payroll.costing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.costing_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.costing_rules;
DROP POLICY IF EXISTS tenant_isolation ON payroll.costing_rules;
CREATE POLICY tenant_isolation_policy ON payroll.costing_rules
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.dearness_allowance_rates
ALTER TABLE payroll.dearness_allowance_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.dearness_allowance_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.dearness_allowance_rates;
DROP POLICY IF EXISTS tenant_isolation ON payroll.dearness_allowance_rates;
CREATE POLICY tenant_isolation_policy ON payroll.dearness_allowance_rates
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.flex_benefit_elections
ALTER TABLE payroll.flex_benefit_elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.flex_benefit_elections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.flex_benefit_elections;
DROP POLICY IF EXISTS tenant_isolation ON payroll.flex_benefit_elections;
CREATE POLICY tenant_isolation_policy ON payroll.flex_benefit_elections
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.flex_benefit_plans
ALTER TABLE payroll.flex_benefit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.flex_benefit_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.flex_benefit_plans;
DROP POLICY IF EXISTS tenant_isolation ON payroll.flex_benefit_plans;
CREATE POLICY tenant_isolation_policy ON payroll.flex_benefit_plans
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.off_cycle_items
ALTER TABLE payroll.off_cycle_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.off_cycle_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.off_cycle_items;
DROP POLICY IF EXISTS tenant_isolation ON payroll.off_cycle_items;
CREATE POLICY tenant_isolation_policy ON payroll.off_cycle_items
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.off_cycle_runs
ALTER TABLE payroll.off_cycle_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.off_cycle_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.off_cycle_runs;
DROP POLICY IF EXISTS tenant_isolation ON payroll.off_cycle_runs;
CREATE POLICY tenant_isolation_policy ON payroll.off_cycle_runs
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.pay_groups
ALTER TABLE payroll.pay_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.pay_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.pay_groups;
DROP POLICY IF EXISTS tenant_isolation ON payroll.pay_groups;
CREATE POLICY tenant_isolation_policy ON payroll.pay_groups
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_settings
ALTER TABLE payroll.payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_settings;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_settings;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_settings
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.salary_corrections
ALTER TABLE payroll.salary_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.salary_corrections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.salary_corrections;
DROP POLICY IF EXISTS tenant_isolation ON payroll.salary_corrections;
CREATE POLICY tenant_isolation_policy ON payroll.salary_corrections
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.simulation_results
ALTER TABLE payroll.simulation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.simulation_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.simulation_results;
DROP POLICY IF EXISTS tenant_isolation ON payroll.simulation_results;
CREATE POLICY tenant_isolation_policy ON payroll.simulation_results
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- ── Upgrade USING-only policies to USING + WITH CHECK ─────────────

-- payroll.payroll_arrears
ALTER TABLE payroll.payroll_arrears ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_arrears FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_arrears;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_arrears;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_arrears
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_bonus
ALTER TABLE payroll.payroll_bonus ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_bonus FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_bonus;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_bonus;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_bonus
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_ctc_config
ALTER TABLE payroll.payroll_ctc_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_ctc_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_ctc_config;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_ctc_config;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_ctc_config
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_lwf
ALTER TABLE payroll.payroll_lwf ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_lwf FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_lwf;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_lwf;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_lwf
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_professional_tax
ALTER TABLE payroll.payroll_professional_tax ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_professional_tax FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_professional_tax;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_professional_tax;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_professional_tax
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_register
ALTER TABLE payroll.payroll_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_register FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_register;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_register;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_register
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_reimbursements
ALTER TABLE payroll.payroll_reimbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_reimbursements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_reimbursements;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_reimbursements;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_reimbursements
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_salary_revisions
ALTER TABLE payroll.payroll_salary_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_salary_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_salary_revisions;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_salary_revisions;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_salary_revisions
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
