-- payroll-service RLS migration: tenant isolation backstop
-- Role: payroll_svc on civitas_payroll
-- Applied AFTER 0014_multi_ddo_pensioner.sql
-- Additive only — no DROP TABLE, no ALTER COLUMN, no data changes.

-- Helper function: reads app.tenant_id from session variable (SET LOCAL by middleware)
CREATE OR REPLACE FUNCTION payroll.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ── payroll schema ────────────────────────────────────────────────
ALTER TABLE payroll.payroll_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_slips  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_runs   FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_slips  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_runs;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_slips;

CREATE POLICY tenant_isolation ON payroll.payroll_runs
  USING (tenant_id = payroll.current_tenant_id());
CREATE POLICY tenant_isolation ON payroll.payroll_slips
  USING (tenant_id = payroll.current_tenant_id());

-- ── loans schema ──────────────────────────────────────────────────
ALTER TABLE loans.payroll_loans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans.payroll_loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans.payroll_loans           FORCE ROW LEVEL SECURITY;
ALTER TABLE loans.payroll_loan_repayments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON loans.payroll_loans;
DROP POLICY IF EXISTS tenant_isolation ON loans.payroll_loan_repayments;

CREATE POLICY tenant_isolation ON loans.payroll_loans
  USING (tenant_id = payroll.current_tenant_id());
CREATE POLICY tenant_isolation ON loans.payroll_loan_repayments
  USING (tenant_id = payroll.current_tenant_id());

-- ── statutory schema ──────────────────────────────────────────────
ALTER TABLE statutory.payroll_pf       ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_tds      ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_pf       FORCE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_tds      FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_pf;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_tds;

CREATE POLICY tenant_isolation ON statutory.payroll_pf
  USING (tenant_id = payroll.current_tenant_id());
CREATE POLICY tenant_isolation ON statutory.payroll_tds
  USING (tenant_id = payroll.current_tenant_id());

-- ── _outbox schema ────────────────────────────────────────────────
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = payroll.current_tenant_id());
