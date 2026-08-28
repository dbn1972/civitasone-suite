-- Closes a gap left by 0016_check_constraints_status_columns.sql: three of
-- its nine status CHECK constraints were added NOT VALID but never
-- successfully VALIDATEd on the long-lived shared dev database (unlike a
-- fresh container, where 0016 validates all nine in the same pass because
-- the tables are empty). Confirmed via pg_constraint.convalidated on the
-- shared dev DB:
--   plan.audit_plans.audit_plans_status_check                      -> f
--   plan.audit_plan_items.audit_plan_item_status_check              -> f
--   observation.audit_observations.audit_observations_status_check -> f
--   (the other six: exports, audit_paras, both compliance tables, both
--    audit_risks constraints -> already t)
--
-- The NOT VALID constraints have been enforcing all new INSERT/UPDATE since
-- 0016 ran (that is Postgres's normal NOT VALID semantics) -- this migration
-- does not change write behavior. What was missing is the retroactive scan
-- that certifies pre-existing rows and flips convalidated to true, and that
-- scan was genuinely failing: three DEV DEMO seed rows used status values
-- from before the enum was finalized ('approved', 'planned',
-- 'pending_reply' -- none written by current application code). See
-- 0025_fix_legacy_status_values.sql, which must run before this file and
-- corrects those three rows by primary key. After that fix, all three
-- VALIDATEs below succeed.
--
-- (Why an earlier no-tenant-context SELECT missed this: these tables carry
-- FORCE ROW LEVEL SECURITY and audit_svc has no BYPASSRLS, so a plain
-- SELECT with no app.tenant_id GUC set silently sees zero rows everywhere
-- -- VALIDATE CONSTRAINT, which scans the physical heap, is not filtered by
-- RLS and is what actually surfaced the violation.)
--
-- Idempotent: ALTER TABLE ... VALIDATE CONSTRAINT is a no-op when the
-- constraint is already valid, so this is safe to re-run and safe on a
-- fresh container where 0016 already validated everything in one pass.

SET lock_timeout = '5s';

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_plans_status_check'
      AND conrelid = 'plan.audit_plans'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE plan.audit_plans
      VALIDATE CONSTRAINT audit_plans_status_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_plan_items_status_check'
      AND conrelid = 'plan.audit_plan_items'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE plan.audit_plan_items
      VALIDATE CONSTRAINT audit_plan_items_status_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_observations_status_check'
      AND conrelid = 'observation.audit_observations'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE observation.audit_observations
      VALIDATE CONSTRAINT audit_observations_status_check;
  END IF;
END
$body$;
