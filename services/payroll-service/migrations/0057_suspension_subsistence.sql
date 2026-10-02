-- 0057_suspension_subsistence.sql
--
-- URGENT money fix: payroll paid SUSPENDED employees their full salary.
-- hrms-service's payroll-input feed has always sent `paySuspended`, but
-- nothing in payroll-service read it. The run now pays an FR 53 subsistence
-- allowance (government pay-scale engagements) or withholds pay and flags HR
-- (any other engagement) -- see src/modules/payroll/subsistence.ts.
--
-- 1) Tenant-configurable FR 53 percentages on payroll.payroll_settings
--    (basis points, so 5000 = 50.00%). Defaults are FR 53's own numbers, so a
--    tenant that never touches them gets the rule as written:
--      initial rate 50% of basic for the first 90 days;
--      a recorded review order is applied only inside 25%..75%
--      (FR 53(1)(ii)(a): +/- up to 50% of the first-3-months amount).
--    NOT NULL with a constant DEFAULT: metadata-only on PG >= 11, no rewrite.
--
-- 2) payroll.payroll_run_suspensions: one row per (run, suspended employee)
--    recording how that employee was treated (subsistence | withheld), the
--    day split, rates applied and any HR flags ("review order due", ...).
--    This is the run summary's suspended-employee list and the audit trail
--    for the amounts. UNIQUE(tenant_id, run_id, employee_id) makes a resumed
--    or re-delivered run idempotent (the writer uses ON CONFLICT DO NOTHING,
--    matching payroll_slips' own UNIQUE(tenant_id, run_id, employee_id)).
--
-- Migration number: 0053 is taken by the disbursement ledger (#1774) and
-- 0054-0056 are reserved by the pay-profiles work, so this takes 0057.
--
-- Rollback:
--   DROP TABLE IF EXISTS payroll.payroll_run_suspensions;
--   ALTER TABLE payroll.payroll_settings
--     DROP CONSTRAINT IF EXISTS payroll_settings_subsistence_check,
--     DROP COLUMN IF EXISTS subsistence_initial_pct_bps,
--     DROP COLUMN IF EXISTS subsistence_review_after_days,
--     DROP COLUMN IF EXISTS subsistence_revised_min_pct_bps,
--     DROP COLUMN IF EXISTS subsistence_revised_max_pct_bps;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS subsistence_initial_pct_bps     INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS subsistence_review_after_days   INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS subsistence_revised_min_pct_bps INTEGER NOT NULL DEFAULT 2500,
  ADD COLUMN IF NOT EXISTS subsistence_revised_max_pct_bps INTEGER NOT NULL DEFAULT 7500;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payroll_settings_subsistence_check'
       AND conrelid = 'payroll.payroll_settings'::regclass
  ) THEN
    ALTER TABLE payroll.payroll_settings
      ADD CONSTRAINT payroll_settings_subsistence_check CHECK (
        subsistence_initial_pct_bps BETWEEN 0 AND 10000
        AND subsistence_review_after_days BETWEEN 1 AND 366
        AND subsistence_revised_min_pct_bps BETWEEN 0 AND 10000
        AND subsistence_revised_max_pct_bps BETWEEN 0 AND 10000
        AND subsistence_revised_min_pct_bps <= subsistence_revised_max_pct_bps
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll.payroll_run_suspensions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  run_id               UUID NOT NULL,
  employee_id          UUID NOT NULL,
  employee_no          TEXT NOT NULL,
  suspension_id        UUID,
  treatment            VARCHAR(16) NOT NULL CHECK (treatment IN ('subsistence', 'withheld')),
  suspension_from      DATE,
  suspension_to        DATE,
  days_in_month        INTEGER NOT NULL CHECK (days_in_month BETWEEN 28 AND 31),
  regular_days         INTEGER NOT NULL DEFAULT 0 CHECK (regular_days >= 0),
  subsistence_days     INTEGER NOT NULL DEFAULT 0 CHECK (subsistence_days >= 0),
  initial_pct_bps      INTEGER,
  revised_pct_bps      INTEGER,
  subsistence_minor    BIGINT NOT NULL DEFAULT 0 CHECK (subsistence_minor >= 0),
  subsistence_da_minor BIGINT NOT NULL DEFAULT 0 CHECK (subsistence_da_minor >= 0),
  flags                TEXT[] NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           UUID NOT NULL,
  CONSTRAINT ux_payroll_run_suspensions_run_emp UNIQUE (tenant_id, run_id, employee_id),
  CONSTRAINT payroll_run_suspensions_days_check CHECK (regular_days + subsistence_days <= days_in_month)
);

CREATE INDEX IF NOT EXISTS ix_payroll_run_suspensions_tenant_run
  ON payroll.payroll_run_suspensions (tenant_id, run_id);

ALTER TABLE payroll.payroll_run_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_run_suspensions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_run_suspensions;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_run_suspensions
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
