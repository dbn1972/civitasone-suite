-- Migration 0092: PFMS release hardening (follow-up to 0090 / GAP-FINANCE-PFMS-01)
--
-- 1. send_unknown: operator-visible state for a release whose outcome is ambiguous (worker died between the
--    signed->processing claim and the final write, so the file may or may not have reached the PFMS gateway).
--    A sweeper moves a batch stuck in processing there; a finance_admin resolves it (confirmed sent / not sent).
-- 2. release bookkeeping: when a release was claimed and by whom (maker != checker on resolve), and the last
--    failed release attempt (so the UI can show it after the 202).
-- 3. finance_scanner (BYPASSRLS, outbox maintenance role) may READ stuck batches across tenants for the sweeper; every
--    write the sweeper makes goes through the normal tenant-scoped pool.
--
-- Additive + idempotent. Rollback: drop the added columns/index, restore the 0076 status list.
SET lock_timeout = '5s';

ALTER TABLE payments.finance_pfms DROP CONSTRAINT IF EXISTS finance_pfms_submission_status_check;
ALTER TABLE payments.finance_pfms
  ADD CONSTRAINT finance_pfms_submission_status_check
  CHECK (submission_status IN (
    'pending', 'file_sent', 'signed', 'submitted',
    'accepted', 'rejected', 'processing', 'completed', 'failed', 'send_unknown'
  ));

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS release_started_at          timestamptz,
  ADD COLUMN IF NOT EXISTS released_by                 uuid,
  ADD COLUMN IF NOT EXISTS last_release_failure_code   varchar(40),
  ADD COLUMN IF NOT EXISTS last_release_failure_at     timestamptz;

CREATE INDEX IF NOT EXISTS idx_finance_pfms_release_in_flight
  ON payments.finance_pfms (release_started_at)
  WHERE submission_status = 'processing' AND release_started_at IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_scanner') THEN
    GRANT USAGE ON SCHEMA payments TO finance_scanner;
    GRANT SELECT ON payments.finance_pfms TO finance_scanner;
  END IF;
END $$;
