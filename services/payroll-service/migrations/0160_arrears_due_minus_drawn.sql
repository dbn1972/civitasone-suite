-- 0160_arrears_due_minus_drawn.sql
--
-- T-STAT F03 / M-NPS (statutory audit 2026-11-03). Retro arrears are now
-- "pay due for the month under the revised rates - pay actually drawn for
-- it" (payroll/consumer.ts generateRetroArrears). Two additive columns on
-- payroll.payroll_arrears:
--
--   settled_in_period  the run month (YYYY-MM) whose run raised a
--                      revision-arrear row. A month can now be settled more
--                      than once -- e.g. a second DA revision after the first
--                      one was paid -- each time for the increment only, so
--                      the revision-dedupe key becomes
--                      (tenant, employee, component, from_period, settled_in_period).
--                      Re-processing the same run month is still a no-op.
--                      Existing rows get the empty string, which keeps them
--                      unique exactly as the old key did.
--   pension_base_minor the Basic + DA part of the arrear (same sign
--                      convention as difference_minor), which the NPS 10% /
--                      14% now also fall on. NULL on rows written before this
--                      migration (not reconstructed).
--
-- No existing row value changes (historical arrears and slips are left as
-- they are). FORCE ROW LEVEL SECURITY on the table is unchanged (0020).
--
-- Idempotent. Rollback:
--   CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_arrears_revision_period
--     ON payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period)
--     WHERE source = 'revision';   -- fails if a month was settled twice
--   DROP INDEX IF EXISTS payroll.ux_payroll_arrears_revision_settled;
--   ALTER TABLE payroll.payroll_arrears
--     DROP COLUMN IF EXISTS pension_base_minor,
--     DROP COLUMN IF EXISTS settled_in_period;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_arrears
  ADD COLUMN IF NOT EXISTS settled_in_period VARCHAR(7) NOT NULL DEFAULT '';

ALTER TABLE payroll.payroll_arrears
  ADD COLUMN IF NOT EXISTS pension_base_minor BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_arrears_revision_settled
  ON payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period, settled_in_period)
  WHERE source = 'revision';

DROP INDEX IF EXISTS payroll.ux_payroll_arrears_revision_period;
