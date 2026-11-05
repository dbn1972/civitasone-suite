-- 0162_sanction_approved_by.sql
-- UAT ux-docs (PR #2463 review, blocker 2): the issued sanction order must be signed and dated by
-- the officer who APPROVED the sanction. The order used updated_by / updated_at, which every bill
-- booked against the sanction rewrites (payments consumer -> incrementSanctionUtilisedGuarded),
-- so after the first bill the order named the bill clerk and the booking date.
--
-- approved_by / approved_at are written only when a sanction becomes approved (direct approve or
-- the eOffice decision) and are never overwritten: a BEFORE UPDATE trigger keeps the first values
-- once set (a later write to them is ignored, so no existing update path can fail because of it).
-- Existing approved sanctions are filled by scripts/backfill-sanction-approvals.ts (dry run by
-- default), from the approval event actor and time.
--
-- Additive + idempotent; existing rows keep NULL. The table is already FORCE RLS + granted.
-- Rollback:
--   DROP TRIGGER IF EXISTS finance_sanctions_keep_approval ON budget.finance_sanctions;
--   DROP FUNCTION IF EXISTS budget.finance_sanctions_keep_approval();
--   ALTER TABLE budget.finance_sanctions DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS approved_by;
-- Affected services: finance-service (budget module, voucher-print sanction order)

SET lock_timeout = '5s';

ALTER TABLE budget.finance_sanctions
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE OR REPLACE FUNCTION budget.finance_sanctions_keep_approval() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approved_by IS NOT NULL THEN
    NEW.approved_by := OLD.approved_by;
    NEW.approved_at := OLD.approved_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS finance_sanctions_keep_approval ON budget.finance_sanctions;
CREATE TRIGGER finance_sanctions_keep_approval
  BEFORE UPDATE ON budget.finance_sanctions
  FOR EACH ROW EXECUTE FUNCTION budget.finance_sanctions_keep_approval();
