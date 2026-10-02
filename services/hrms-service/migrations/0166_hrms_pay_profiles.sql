-- 0166_hrms_pay_profiles.sql
--
-- PAY-PROFILES (PR1): per-employee, effective-dated PAY PROFILE -- which pay
-- computation payroll applies to an employee. Before this, payroll-service
-- applied one formula (central DA + 7th CPC HRA slab) to every payroll-
-- eligible employee and never learned whether someone is a deputationist
-- (Option A parent scale / Option B post scale), a CTC contract employee or a
-- consolidated-pay contract employee.
--
-- No row for an employee == 'govt_scale', i.e. exactly today's behaviour. No
-- rows are back-filled, so this migration alone changes no payslip.
--
-- Maker-checker: a change is REQUESTED (status 'pending', no effect on pay)
-- and becomes effective only when a different user APPROVES it ('active').
-- Approval closes the previous open active row (effective_to = new
-- effective_from - 1). v1 rule: profiles change only from the 1st of a month.
--
-- deputation_terms: for the two deputation profiles, the deputation-order
-- MONEY terms (option, station, parent/post level + basic, allowance mode +
-- amount, DA source + rate, parent pension scheme) captured at request time
-- and approved with the profile. Payroll is fed these, never the live
-- deputation row, so a pay-affecting term change always goes through this
-- maker-checker (a new profile request) and history stays reproducible.
--
-- Additive + idempotent.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee.hrms_pay_profiles (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL,
  employee_id                 uuid        NOT NULL,
  pay_profile                 varchar(32) NOT NULL,
  effective_from              date        NOT NULL,
  effective_to                date,
  status                      varchar(16) NOT NULL DEFAULT 'pending',
  deputation_id               uuid,
  consolidated_monthly_minor  bigint,
  deputation_terms            jsonb,
  order_ref                   varchar(120),
  remarks                     text,
  requested_by                uuid        NOT NULL,
  decided_by                  uuid,
  decided_at                  timestamptz,
  decision_note               varchar(500),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid        NOT NULL,
  updated_by                  uuid        NOT NULL,
  version                     integer     NOT NULL DEFAULT 1
);

ALTER TABLE employee.hrms_pay_profiles ADD COLUMN IF NOT EXISTS deputation_terms jsonb;

DO $$ BEGIN
  ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_deputation_terms_chk
    CHECK (pay_profile NOT IN ('deputation_parent_scale','deputation_post_scale') OR deputation_terms IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_profile_chk
    CHECK (pay_profile IN ('govt_scale','deputation_parent_scale','deputation_post_scale','ctc_contract','consolidated_contract'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_status_chk
    CHECK (status IN ('pending','active','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_month_start_chk
    CHECK (EXTRACT(DAY FROM effective_from) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_deputation_chk
    CHECK (pay_profile NOT IN ('deputation_parent_scale','deputation_post_scale') OR deputation_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_consolidated_chk
    CHECK (pay_profile <> 'consolidated_contract'
           OR (consolidated_monthly_minor IS NOT NULL AND consolidated_monthly_minor > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_amount_nonneg_chk
    CHECK (consolidated_monthly_minor IS NULL OR consolidated_monthly_minor >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One pending-or-active row per (employee, effective_from); at most one OPEN
-- active row per employee. Rejected rows never block a re-request.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hrms_pay_profiles_emp_from_live
  ON employee.hrms_pay_profiles (tenant_id, employee_id, effective_from)
  WHERE status IN ('pending','active');
CREATE UNIQUE INDEX IF NOT EXISTS ux_hrms_pay_profiles_emp_open_active
  ON employee.hrms_pay_profiles (tenant_id, employee_id)
  WHERE status = 'active' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_hrms_pay_profiles_tenant_range
  ON employee.hrms_pay_profiles (tenant_id, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_hrms_pay_profiles_deputation
  ON employee.hrms_pay_profiles (deputation_id);

ALTER TABLE employee.hrms_pay_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_pay_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_pay_profiles;
CREATE POLICY tenant_isolation_policy ON employee.hrms_pay_profiles
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
