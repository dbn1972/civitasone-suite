-- revenue-service: maker-checker on instalment plans
-- Purpose: Owner decision #3 (2026-10-26, GAP-REVENUE-INSTALMENTS-03). An instalment
--          plan defers a demand, so it needs a second officer: a plan is created
--          `pending` and only becomes `active` when a DIFFERENT officer approves
--          it (or `rejected`). Adds the checker, decision time and reason columns
--          and makes `pending` the default status. Pre-existing rows keep their
--          current status (active / completed / defaulted) untouched.
-- Rollback: ALTER TABLE arrears.instalment_plans DROP COLUMN checker_user_id, DROP COLUMN decided_at, DROP COLUMN decision_reason;
--           ALTER TABLE arrears.instalment_plans ALTER COLUMN status SET DEFAULT 'active';
-- Affected services: revenue-service
-- RLS: arrears.instalment_plans already has tenant-isolation RLS (0002); adding columns does not change it.

SET lock_timeout = '5s';

ALTER TABLE arrears.instalment_plans
  ADD COLUMN IF NOT EXISTS checker_user_id uuid,
  ADD COLUMN IF NOT EXISTS decided_at      timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text;

ALTER TABLE arrears.instalment_plans ALTER COLUMN status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_instalment_plans_tenant_status
  ON arrears.instalment_plans (tenant_id, status, created_at DESC);
