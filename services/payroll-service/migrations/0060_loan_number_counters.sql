-- 0060_loan_number_counters.sql
-- GAP-PAYROLL-LOANS-05: loan numbers were typed by hand (free text), so two
-- clerks could collide or invent inconsistent formats. The server now
-- allocates the number when the request omits one: LN-<year>-<6-digit seq>,
-- per tenant per calendar year, from this counter. The allocation is a single
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING inside the create-loan
-- transaction, so concurrent creates serialise on the counter row and can
-- never receive the same number. (The existing UNIQUE (tenant_id, loan_no)
-- on loans.payroll_loans stays the backstop for hand-typed numbers.)
--
-- Rollback:
--   DROP TABLE IF EXISTS loans.loan_number_counters;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS loans.loan_number_counters (
  tenant_id  uuid    NOT NULL,
  year       integer NOT NULL,
  last_seq   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year),
  CONSTRAINT loan_number_counters_seq_check CHECK (last_seq >= 0)
);
ALTER TABLE loans.loan_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans.loan_number_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON loans.loan_number_counters;
CREATE POLICY tenant_isolation_policy ON loans.loan_number_counters
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
