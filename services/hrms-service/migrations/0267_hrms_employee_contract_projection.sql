-- 0267_hrms_employee_contract_projection.sql
--
-- Section 8 gap G5: contract end + project on the employee record, and a tenant
-- policy for what happens when a contract lapses.
--
--  1. employee.hrms_employees gets READ-MODEL columns (contract + project snapshot).
--     They are projections of contracts.hrms_contracts, never authoritative: writes go
--     through the contracts module and the projection is recomputed from it. All NULL.
--  2. contracts.hrms_contract_config gets the tenant policy + routing settings. Every
--     default reproduces today exactly: lapse_action = auto_separate, no extra notify
--     roles, projection OFF. No existing tenant changes behaviour until it opts in.
--
-- No backfill here on purpose: backfilling would change the employee list/profile
-- payload of every existing tenant. The projection is filled per tenant, by the
-- reconcile job, only once the tenant turns employee_projection_enabled on.
--
-- Additive and idempotent. Rollback:
--   ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS contract_id, DROP COLUMN IF EXISTS
--     contract_start_date, DROP COLUMN IF EXISTS contract_end_date, DROP COLUMN IF EXISTS contract_status,
--     DROP COLUMN IF EXISTS contract_renewal_count, DROP COLUMN IF EXISTS primary_project_id,
--     DROP COLUMN IF EXISTS project_code, DROP COLUMN IF EXISTS project_name;
--   ALTER TABLE contracts.hrms_contract_config DROP COLUMN IF EXISTS lapse_action, DROP COLUMN IF EXISTS
--     grace_days, DROP COLUMN IF EXISTS notify_roles, DROP COLUMN IF EXISTS employee_projection_enabled,
--     DROP COLUMN IF EXISTS weekly_digest_enabled;

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS contract_id            uuid,
  ADD COLUMN IF NOT EXISTS contract_start_date    date,
  ADD COLUMN IF NOT EXISTS contract_end_date      date,
  ADD COLUMN IF NOT EXISTS contract_status        varchar(24),
  ADD COLUMN IF NOT EXISTS contract_renewal_count integer,
  ADD COLUMN IF NOT EXISTS primary_project_id     uuid,
  ADD COLUMN IF NOT EXISTS project_code           varchar(32),
  ADD COLUMN IF NOT EXISTS project_name           varchar(160);

CREATE INDEX IF NOT EXISTS hrms_employees_contract_end_idx
  ON employee.hrms_employees (tenant_id, contract_end_date)
  WHERE contract_end_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS hrms_employees_primary_project_idx
  ON employee.hrms_employees (tenant_id, primary_project_id)
  WHERE primary_project_id IS NOT NULL;

ALTER TABLE contracts.hrms_contract_config
  ADD COLUMN IF NOT EXISTS lapse_action                varchar(16) NOT NULL DEFAULT 'auto_separate',
  ADD COLUMN IF NOT EXISTS grace_days                  integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notify_roles                jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS employee_projection_enabled boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled       boolean     NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hrms_contract_config_lapse_action_chk') THEN
    ALTER TABLE contracts.hrms_contract_config
      ADD CONSTRAINT hrms_contract_config_lapse_action_chk CHECK (lapse_action IN ('auto_separate', 'flag_only'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hrms_contract_config_grace_days_chk') THEN
    ALTER TABLE contracts.hrms_contract_config
      ADD CONSTRAINT hrms_contract_config_grace_days_chk CHECK (grace_days BETWEEN 0 AND 365);
  END IF;
END $$;
