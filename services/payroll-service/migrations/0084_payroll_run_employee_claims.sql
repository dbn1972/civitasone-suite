-- 0084_payroll_run_employee_claims.sql
--
-- GAP-PAYROLL-PAY-GROUPS-03 hard invariant: an employee cannot be included in
-- two non-cancelled REGULAR runs for the same period. A run claims every
-- employee it pays (inside the same transaction that writes the slips); the
-- PRIMARY KEY (tenant, employee, month) makes a second claim impossible, so
-- the invariant holds under concurrency. A claim is released automatically
-- when its run becomes failed / cancelled. Idempotent. FORCE RLS.

CREATE TABLE IF NOT EXISTS payroll.payroll_run_employee_claims (
  tenant_id   UUID        NOT NULL,
  employee_id UUID        NOT NULL,
  month       CHAR(7)     NOT NULL,
  run_id      UUID        NOT NULL REFERENCES payroll.payroll_runs (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, employee_id, month)
);
CREATE INDEX IF NOT EXISTS ix_prec_run ON payroll.payroll_run_employee_claims (tenant_id, run_id);

ALTER TABLE payroll.payroll_run_employee_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_run_employee_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_run_employee_claims;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_run_employee_claims
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

CREATE OR REPLACE FUNCTION payroll.release_run_claims() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM payroll.payroll_run_employee_claims WHERE tenant_id = NEW.tenant_id AND run_id = NEW.id;
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_release_run_claims ON payroll.payroll_runs;
CREATE TRIGGER trg_release_run_claims
  AFTER UPDATE OF status ON payroll.payroll_runs
  FOR EACH ROW
  WHEN (NEW.status IN ('failed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION payroll.release_run_claims();
