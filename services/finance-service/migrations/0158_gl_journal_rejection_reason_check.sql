-- 0158_gl_journal_rejection_reason_check.sql
-- UAT Phase 2 (J6, review follow-up): a 'rejected' journal must carry a rejection_reason of at least 10 characters
-- (blank-trimmed), the same rule PATCH /v1/finance/journals/:id/reject and the finance.gl.reject consumer apply.
-- Guarded and idempotent: DROP CONSTRAINT IF EXISTS + ADD ... NOT VALID, then VALIDATE only when no existing row
-- breaks the rule. Existing rows are never modified (a rejected journal is read-only, migration 0157): if a
-- non-conforming rejected row is found the constraint stays NOT VALID -- it still applies to every new or updated
-- row -- and a NOTICE says so, for investigation. Safe to re-run.
-- Rollback: ALTER TABLE gl.finance_journals DROP CONSTRAINT IF EXISTS finance_journals_rejection_reason_check;

SET lock_timeout = '5s';

ALTER TABLE gl.finance_journals
  DROP CONSTRAINT IF EXISTS finance_journals_rejection_reason_check;

ALTER TABLE gl.finance_journals
  ADD CONSTRAINT finance_journals_rejection_reason_check
  CHECK (status <> 'rejected' OR (rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) >= 10))
  NOT VALID;

-- VALIDATE scans every row regardless of row-level security; a violation is caught (not a failed migration).
DO $$
BEGIN
  ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT finance_journals_rejection_reason_check;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'finance_journals_rejection_reason_check left NOT VALID: an existing rejected journal has no reason of 10+ characters (rejected rows are read-only and are not modified); it still applies to every new or updated row';
END $$;
