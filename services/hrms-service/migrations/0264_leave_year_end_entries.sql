-- 0264_leave_year_end_entries.sql
--
-- UAT T-PERIOD D-14 (ERP-head decision 2026-11-05): leave year = calendar year
-- per the CCS (Leave) Rules 1972 -- EL credited in advance, 15 days on 1 Jan and
-- 1 Jul (pro rata 2.5 days per completed month for joiners, reduced by 1/10th of
-- the EOL of the previous half-year), 300-day ceiling with the excess lapsed and
-- recorded; HPL 10 days on the same dates (when modelled); CL lapses on 31 Dec.
-- The job is modules/leave/year-end-job.ts; rules in modules/leave/year-end.ts.
--
-- leave.hrms_leave_year_end_entries: one row per change the job makes --
-- carry_forward / cap_lapse / credit / lapse, with the days, the allocation it
-- touched and the leave-year allocation it credited -- so every credit and
-- lapse is auditable and the job is idempotent: UNIQUE (tenant, credit date,
-- employee, leave type, action); an employee + type with any row for a credit
-- date is never processed again for it.
--
-- leave.hrms_leave_year_config.year_start_month (migration 0006, default 1 =
-- calendar year) is the per-tenant switch; 4 keeps a financial leave year
-- (half-years from 1 Apr / 1 Oct). Only 1 or 4 are accepted from now on.
--
-- leave.hrms_leave_year_config.superannuation_ages (PR #2459 delta review SF4):
-- age of superannuation per employee type for the Rule 27(2)(a) retirement
-- half-year credit (FR 56: the last day of the month of attaining it). Default
-- 60 for permanent / temporary / deputation; a type that is not listed (e.g.
-- contract) is never superannuated by the job. Resignation / VRS etc. come
-- from the approved / completed lifecycle.hrms_separations last working date.
--
-- Additive and idempotent. FORCE RLS tenant policy like every leave table.
--
-- Rollback:
--   DROP TABLE IF EXISTS leave.hrms_leave_year_end_entries;
--   ALTER TABLE leave.hrms_leave_year_config DROP CONSTRAINT IF EXISTS hrms_leave_year_config_start_month_chk;
--   ALTER TABLE leave.hrms_leave_year_config DROP COLUMN IF EXISTS superannuation_ages;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS leave.hrms_leave_year_end_entries (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid         NOT NULL,
  run_key          date         NOT NULL,
  leave_year       varchar(7)   NOT NULL,
  employee_id      uuid         NOT NULL,
  leave_type_id    uuid         NOT NULL,
  leave_code       varchar(8)   NOT NULL,
  action           varchar(16)  NOT NULL,
  days             numeric(6,1) NOT NULL,
  alloc_id         uuid,
  target_alloc_id  uuid,
  note             text,
  created_by       uuid         NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT hrms_leave_year_end_entries_action_chk CHECK (action IN ('carry_forward', 'cap_lapse', 'credit', 'lapse')),
  CONSTRAINT hrms_leave_year_end_entries_days_chk CHECK (days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_hrms_leave_year_end_entries
  ON leave.hrms_leave_year_end_entries (tenant_id, run_key, employee_id, leave_type_id, action);
CREATE INDEX IF NOT EXISTS ix_hrms_leave_year_end_entries_emp
  ON leave.hrms_leave_year_end_entries (tenant_id, employee_id, run_key);

ALTER TABLE leave.hrms_leave_year_end_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_year_end_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_year_end_entries;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_year_end_entries
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_svc') THEN
    GRANT SELECT, INSERT ON leave.hrms_leave_year_end_entries TO hrms_svc;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE leave.hrms_leave_year_config
    ADD CONSTRAINT hrms_leave_year_config_start_month_chk CHECK (year_start_month IN (1, 4)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE leave.hrms_leave_year_config
  ADD COLUMN IF NOT EXISTS superannuation_ages jsonb NOT NULL DEFAULT '{"permanent": 60, "temporary": 60, "deputation": 60}'::jsonb;
DO $$ BEGIN
  ALTER TABLE leave.hrms_leave_year_config
    ADD CONSTRAINT hrms_leave_year_config_superannuation_ages_chk CHECK (jsonb_typeof(superannuation_ages) = 'object') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
