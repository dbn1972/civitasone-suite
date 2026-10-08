-- revenue-service migration 0015 — adjustment maker-checker (GAP-REVENUE-ADJUSTMENTS-01)
-- Applied AFTER 0014_refund_receipt_unique.sql
-- Rollback:
--   ALTER TABLE collection.adjustments
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS maker_user_id,
--     DROP COLUMN IF EXISTS checker_user_id,
--     DROP COLUMN IF EXISTS decided_at,
--     DROP COLUMN IF EXISTS updated_at;
--
-- GAP-REVENUE-ADJUSTMENTS-01 (fraud / approvals): a balance-transfer
-- adjustment debited the source demand and credited the target demand
-- IMMEDIATELY in the adjustmentCreate consumer, with no pending/approved
-- lifecycle and no checker!=maker rule — unlike refunds (collection.refunds)
-- and remissions (assessment.remissions), which both carry
-- status/maker_user_id/checker_user_id and are gated by assertMakerChecker in
-- their decide consumer. A single officer could therefore silently move
-- arrears off a defaulter's oldest demand onto another with no second
-- approval and no reversible pending state.
--
-- Fix (expand step): add the same maker-checker lifecycle columns the refunds
-- table already has, so the create step records a PENDING adjustment (no DCB
-- movement) and a distinct checker must approve it before the balance moves.
-- This is additive and idempotent (ADD COLUMN IF NOT EXISTS preserves the
-- existing grants on the table; no new GRANT needed).
--
-- Column choices mirror collection.refunds for consistency:
--   status          varchar(16)  pending|approved|rejected  (default 'pending')
--   maker_user_id   uuid         who raised the adjustment
--   checker_user_id uuid         who decided it (null until decided)
--   decided_at      timestamptz  when it was decided
--   updated_at      timestamptz  standard entity column (adjustments lacked it)
--
-- Backfill for pre-existing rows (CRITICAL — these were ALREADY applied to the
-- DCB ledger under the old immediate-apply behaviour, so their balance moves
-- have already happened and must NOT be re-applied): mark every existing row
-- status='approved' with maker_user_id = created_by and checker_user_id =
-- created_by. This records history honestly (they were effectively
-- self-approved under the old no-checker regime) WITHOUT the decide consumer
-- ever re-processing them (it only ever touches rows it transitions from
-- 'pending'). A FLAG FOR HUMAN REVIEW is recorded in the agent report:
-- historical adjustments were single-officer; only new ones get real
-- maker-checker.

SET lock_timeout = '5s';

ALTER TABLE collection.adjustments
  ADD COLUMN IF NOT EXISTS status          varchar(16),
  ADD COLUMN IF NOT EXISTS maker_user_id   uuid,
  ADD COLUMN IF NOT EXISTS checker_user_id uuid,
  ADD COLUMN IF NOT EXISTS decided_at      timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz;

-- Backfill existing rows (already-applied adjustments) as self-approved so the
-- decide consumer never re-applies them. Idempotent: only touches rows not yet
-- backfilled (status IS NULL).
UPDATE collection.adjustments
   SET status          = COALESCE(status, 'approved'),
       maker_user_id   = COALESCE(maker_user_id, created_by),
       checker_user_id = COALESCE(checker_user_id, created_by),
       decided_at      = COALESCE(decided_at, created_at),
       updated_at      = COALESCE(updated_at, created_at)
 WHERE status IS NULL;

-- Now that every row has a value, enforce NOT NULL + defaults for new rows.
ALTER TABLE collection.adjustments
  ALTER COLUMN status        SET DEFAULT 'pending',
  ALTER COLUMN status        SET NOT NULL,
  ALTER COLUMN maker_user_id SET NOT NULL,
  ALTER COLUMN updated_at    SET DEFAULT now(),
  ALTER COLUMN updated_at    SET NOT NULL;
