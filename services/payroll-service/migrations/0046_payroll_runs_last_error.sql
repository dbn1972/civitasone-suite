-- 0046_payroll_runs_last_error.sql
-- payroll-critical fix: payroll_runs had no column at all to record WHY a run
-- ended up status='failed' -- the consumer's catch block (payroll/consumer.ts,
-- registerPayrollConsumers's COMMANDS.runCreate handler) only ever set the
-- status column and re-threw the error for the queue's own logging/DLQ, so
-- the failure reason was never durably attached to the run row itself. That
-- made a genuinely failed run indistinguishable from a healthy one to
-- anything reading the row later (including, until this same fix's frontend
-- change, the runs list UI, which mapped 'failed' to 'draft').
--
-- Nullable, no default: existing rows (draft/processing/approved/disbursed,
-- and any pre-existing 'failed' rows) simply get NULL here, meaning "no
-- recorded reason" -- exactly the honest state for data this migration
-- cannot retroactively know. Only newly-failing runs (via the consumer fix
-- in the same change) populate it going forward.
--
-- ADD COLUMN ... NULL is a metadata-only change on PG11+ (no table rewrite,
-- no long lock), same posture as migration 0041's ADD COLUMN.
--
-- Rollback: ALTER TABLE payroll.payroll_runs DROP COLUMN last_error;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_runs
  ADD COLUMN IF NOT EXISTS last_error TEXT;
