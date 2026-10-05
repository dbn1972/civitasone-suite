-- GAP-CRM-RTI-NEW-02: record how (and when) an RTI request was physically
-- received, so the 30-day statutory clock starts from the real date of
-- receipt rather than whenever the register entry happens to be filed.
--
-- `received_at` already exists (0081) and the generated `due_at` column is
-- `received_at + 30 days`, so once the API can SET received_at from a
-- clerk-supplied date of receipt, the statutory deadline follows for free.
-- This migration only adds the mode-of-receipt classification.
--
-- Additive + idempotent: a nullable column (existing rows and any caller that
-- omits it stay valid) with a CHECK constraint added guarded.
-- Rollback: ALTER TABLE crm.rti_requests DROP COLUMN IF EXISTS mode;
SET lock_timeout = '5s';

ALTER TABLE crm.rti_requests
  ADD COLUMN IF NOT EXISTS mode text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rti_requests_mode_check'
  ) THEN
    ALTER TABLE crm.rti_requests
      ADD CONSTRAINT rti_requests_mode_check
      CHECK (mode IS NULL OR mode IN ('online', 'post', 'email', 'in_person', 'by_hand'));
  END IF;
END $$;
