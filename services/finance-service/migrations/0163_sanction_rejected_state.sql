-- 0163_sanction_rejected_state.sql
-- UAT bundle 22 (W1/W2): a rejected sanction was stored as "cancelled" with no reason, and a reject
-- arriving after an approval could flip an approved sanction to "cancelled" (approved_by kept).
-- A sanction now ends in an explicit "rejected" state that carries the checker's reason, and the
-- reject handlers only move a sanction that is still awaiting a decision.
--
-- This migration: (1) allows the "rejected" status, (2) adds rejection_reason, (3) re-labels the
-- rows the old reject paths wrote. Before this change the ONLY writers of status "cancelled" on
-- budget.finance_sanctions were the reject consumer (sanctionReject) and the eOffice "rejected"
-- decision, so a cancelled sanction with no approver is a rejected one. A cancelled sanction that
-- has an approver is a sanction an old reject flipped after approval (W1): it is left alone for the
-- finance owner to review (listed by the query in the rollback note), not silently re-approved.
--
-- Additive + idempotent. Rollback:
--   UPDATE budget.finance_sanctions SET status='cancelled' WHERE status='rejected';
--   ALTER TABLE budget.finance_sanctions DROP CONSTRAINT IF EXISTS finance_sanctions_status_check;
--   ALTER TABLE budget.finance_sanctions ADD CONSTRAINT finance_sanctions_status_check
--     CHECK (status IN ('draft','pending_approval','approved','exhausted','cancelled'));
--   ALTER TABLE budget.finance_sanctions DROP COLUMN IF EXISTS rejection_reason;
-- Review list: SELECT id, sanction_no, approved_by, approved_at FROM budget.finance_sanctions
--   WHERE status='cancelled' AND approved_by IS NOT NULL;
-- Affected services: finance-service (budget module)

SET lock_timeout = '5s';

ALTER TABLE budget.finance_sanctions
  ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$ BEGIN
  ALTER TABLE budget.finance_sanctions DROP CONSTRAINT IF EXISTS finance_sanctions_status_check;
  ALTER TABLE budget.finance_sanctions
    ADD CONSTRAINT finance_sanctions_status_check
    CHECK (status IN ('draft','pending_approval','approved','exhausted','rejected','cancelled'));
END $$;

UPDATE budget.finance_sanctions
   SET status = 'rejected'
 WHERE status = 'cancelled' AND approved_by IS NULL;
