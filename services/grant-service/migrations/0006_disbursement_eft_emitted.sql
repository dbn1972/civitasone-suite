-- grant-service: R14 — approval-before-payment for grant disbursements.
-- Additive, idempotent, forward-only.
--
-- Previously the only disbursement path emitted the EFT payout immediately at
-- initiation, and the eOffice "approval" merely flipped state AFTER the money
-- had already gone out. We now support an approval-gated disbursement that is
-- held in `pending_approval` WITHOUT paying; the eOffice approval emits the
-- single EFT. `eft_emitted` is the idempotent guard that guarantees a
-- disbursement is paid at most once, regardless of which path it took.

ALTER TABLE disbursement.grant_disbursements
  ADD COLUMN IF NOT EXISTS eft_emitted boolean NOT NULL DEFAULT false;

-- Backfill: any disbursement that is not in a not-yet-paid holding state has
-- already had its EFT emitted under the legacy immediate-pay path.
UPDATE disbursement.grant_disbursements
   SET eft_emitted = true
 WHERE status NOT IN ('pending_approval', 'cancelled');

-- Latent fix: the original status CHECK (migration 0001) omitted
-- 'pending_approval' and 'cancelled', so the eOffice approval flow could never
-- persist those states. Recreate the constraint with the full state set.
ALTER TABLE disbursement.grant_disbursements
  DROP CONSTRAINT IF EXISTS grant_disbursements_status_check;
ALTER TABLE disbursement.grant_disbursements
  ADD CONSTRAINT grant_disbursements_status_check CHECK (status IN
    ('initiated','completed','failed','pending_approval','cancelled'));

