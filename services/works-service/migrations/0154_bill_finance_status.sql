-- Migration 0154: finance hand-off status on a works RA bill.
--
-- UAT bundle 10 F93 (T6-05): a DO-finalized bill is handed to finance-service as finance.bill.create. When finance
-- refuses it (finance.bill.rejected, e.g. UNKNOWN_VENDOR), the bill used to look finished in works while no finance
-- bill existed. These columns record the hand-off outcome so the bill API and the web bill page can show it.
--   finance_status: NULL (not handed off) | sent | rejected
--   finance_rejection_code / finance_rejection_reason: the refusal finance reported.
--
-- Additive + idempotent; existing rows keep NULL. The table is already FORCE RLS + granted.
-- Rollback:
--   ALTER TABLE works.bills DROP COLUMN IF EXISTS finance_status, DROP COLUMN IF EXISTS finance_rejection_code,
--     DROP COLUMN IF EXISTS finance_rejection_reason, DROP COLUMN IF EXISTS finance_rejected_at;
-- Affected services: works-service (billing module)

BEGIN;

SET lock_timeout = '5s';

ALTER TABLE works.bills
  ADD COLUMN IF NOT EXISTS finance_status           VARCHAR(16),
  ADD COLUMN IF NOT EXISTS finance_rejection_code   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS finance_rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS finance_rejected_at      TIMESTAMPTZ;

COMMIT;
