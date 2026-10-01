-- 0049_salary_correction_decision.sql
-- GAP-PAYROLL-CORRECTIONS-01: payroll.salary_corrections already allowed
-- status 'approved'/'rejected' in its CHECK (0023) but nothing could ever
-- move a row out of 'pending', and there was nowhere to record who decided
-- it. These columns back the new maker-checker endpoints
-- POST /v1/payroll/corrections/:id/approve|reject (decider must differ from
-- created_by, enforced in the route and in the consumer's conditional UPDATE).
--
-- Nullable, no default: existing rows were never decided, so NULL is the
-- honest value. ADD COLUMN ... NULL is metadata-only on PG11+ (no rewrite).
--
-- Rollback:
--   ALTER TABLE payroll.salary_corrections
--     DROP COLUMN IF EXISTS decision_note,
--     DROP COLUMN IF EXISTS decided_at,
--     DROP COLUMN IF EXISTS decided_by;
-- Bounded lock wait, same as 0041/0046-0048: fail fast rather than queue
-- behind a long payroll transaction holding a conflicting lock.
SET lock_timeout = '5s';
ALTER TABLE payroll.salary_corrections
  ADD COLUMN IF NOT EXISTS decided_by    UUID,
  ADD COLUMN IF NOT EXISTS decided_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note VARCHAR(512);
