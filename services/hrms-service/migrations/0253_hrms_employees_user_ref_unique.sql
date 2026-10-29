-- 0253_hrms_employees_user_ref_unique.sql — FQ14: one serving employee per login.
--
-- WHY: self-service resolves "my" employee via hrms_employees.user_ref = JWT sub
-- (employee/actor-link.ts). Nothing in the schema stopped two serving employees
-- of a tenant holding the same user_ref, which locks that login out of
-- self-service (409 AMBIGUOUS_EMPLOYEE_LINK) or, worse, links the wrong person.
-- The application now enforces the rule under one per-login advisory lock
-- (employee/login-holder.ts, used by both the HR link route and the
-- verified-email auto-link); this index enforces it in the database for every
-- writer (imports, ad-hoc SQL, future code).
--
-- What it creates:
--   1. hrms_employees_tenant_user_ref_idx (tenant_id, user_ref) WHERE user_ref
--      IS NOT NULL -- a plain index for the self-service hot path (every
--      request filters by user_ref; there was no index on it at all). Always
--      created.
--   2. hrms_employees_tenant_user_ref_serving_uq -- UNIQUE (tenant_id,
--      user_ref) over link-eligible rows only. The status list MUST match
--      LINK_INELIGIBLE_STATUSES in employee/login-holder.ts.
--
-- Guarded and idempotent: IF NOT EXISTS everywhere. If duplicate serving
-- (tenant_id, user_ref) groups already exist the unique index cannot be built:
-- that is reported with RAISE NOTICE (group count only, no ids or PII) and the
-- unique index is skipped, never failing the migration run. HR must clean the
-- duplicates (PATCH /v1/hrms/employees/:id/login-link with userId null, which
-- is audited), then re-run this migration. (UAT read-only check 2026-10-29: 2
-- duplicate user_ref groups -> the unique index will be skipped there until
-- they are cleaned.)
--
-- Rollback: DROP INDEX IF EXISTS employee.hrms_employees_tenant_user_ref_serving_uq;
--           DROP INDEX IF EXISTS employee.hrms_employees_tenant_user_ref_idx;
-- Affected services: hrms-service

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS hrms_employees_tenant_user_ref_idx
  ON employee.hrms_employees (tenant_id, user_ref)
  WHERE user_ref IS NOT NULL;

DO $body$
DECLARE
  dup_groups integer;
  was_forced boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'employee' AND indexname = 'hrms_employees_tenant_user_ref_serving_uq'
  ) THEN
    RETURN;
  END IF;

  -- Counted across all tenants with FORCE RLS lifted for this block only (the
  -- migration role owns the table; no tenant GUC is set while migrating), then
  -- restored to exactly its previous state.
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'employee.hrms_employees'::regclass;
  IF was_forced THEN
    ALTER TABLE employee.hrms_employees NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO dup_groups FROM (
    SELECT 1 FROM employee.hrms_employees
     WHERE user_ref IS NOT NULL
       AND status NOT IN ('terminated', 'separated', 'retired', 'no_show')
     GROUP BY tenant_id, user_ref
    HAVING count(*) > 1
  ) d;
  IF was_forced THEN
    ALTER TABLE employee.hrms_employees FORCE ROW LEVEL SECURITY;
  END IF;

  IF dup_groups > 0 THEN
    RAISE NOTICE 'hrms_employees: % duplicate serving (tenant_id, user_ref) group(s) exist; hrms_employees_tenant_user_ref_serving_uq NOT created. HR must unlink the duplicates (PATCH /v1/hrms/employees/:id/login-link), then re-run this migration.', dup_groups;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX hrms_employees_tenant_user_ref_serving_uq
    ON employee.hrms_employees (tenant_id, user_ref)
    WHERE user_ref IS NOT NULL
      AND status NOT IN ('terminated', 'separated', 'retired', 'no_show');
END
$body$;
