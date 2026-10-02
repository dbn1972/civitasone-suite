-- 0052_fnf_settlement_workflow.sql
-- GAP-PAYROLL-FNF-01: full & final settlement submit / finance-approve /
-- disburse / reject workflow (maker-checker).
--
-- Before this, payroll.fnf_settlements had a status column but nothing could
-- move a row out of the status the compute consumer wrote ('draft'), and
-- there was nowhere to record who submitted, approved or paid it. The web
-- page's Submit / Finance Approve / Mark Disbursed buttons all 404'd and were
-- removed in #1760.
--
-- State machine (enforced in src/modules/fnf/workflow.ts, re-checked under a
-- row lock in the consumer, and with a status+version predicate on the
-- UPDATE so a double-click or race can only transition once):
--
--   draft | computed --submit--> submitted --finance-approve--> finance_approved
--   finance_approved --disburse--> disbursed                       (terminal)
--   submitted | finance_approved --reject--> rejected
--   rejected --recompute (POST /v1/payroll/fnf/compute)--> computed
--
-- 'rejected' is NOT terminal: it sends the settlement back to the payroll
-- desk, which re-runs the computation with corrected inputs; that resets the
-- row to 'computed' and the maker-checker chain starts again.
--
-- 1) Status CHECK: widened, never narrowed. 0027's values (draft, computed,
--    approved, paid, cancelled) are all kept so no existing row can fail
--    validation; submitted / finance_approved / disbursed / rejected are
--    added. 'finance_approved' is exactly 16 chars, the column's width.
-- 2) Actor/time columns for each transition, the disbursement's
--    user-entered payment reference + date, and the rejection reason.
--    All nullable, no default: existing rows were never transitioned, so NULL
--    is the honest value. ADD COLUMN ... NULL is metadata-only (no rewrite).
-- 3) A disbursed row must carry its payment reference, date and actor
--    (defence in depth behind the route's Zod validation).
--
-- Rollback:
--   ALTER TABLE payroll.fnf_settlements DROP CONSTRAINT IF EXISTS fnf_settlements_disbursed_payment_check;
--   ALTER TABLE payroll.fnf_settlements DROP CONSTRAINT IF EXISTS fnf_settlements_status_check;
--   ALTER TABLE payroll.fnf_settlements ADD CONSTRAINT fnf_settlements_status_check
--     CHECK (status IN ('draft', 'computed', 'approved', 'paid', 'cancelled')) NOT VALID;
--   ALTER TABLE payroll.fnf_settlements
--     DROP COLUMN IF EXISTS computed_by, DROP COLUMN IF EXISTS submitted_by,
--     DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS finance_approved_by,
--     DROP COLUMN IF EXISTS finance_approved_at, DROP COLUMN IF EXISTS disbursed_by,
--     DROP COLUMN IF EXISTS disbursed_at, DROP COLUMN IF EXISTS payment_reference,
--     DROP COLUMN IF EXISTS payment_date, DROP COLUMN IF EXISTS rejected_by,
--     DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS rejection_reason;
--   (only after moving any submitted/finance_approved/disbursed/rejected rows
--   back to an old value)

-- Bounded lock wait, same as 0041/0046-0049: fail fast rather than queue
-- behind a long payroll transaction holding a conflicting lock.
SET lock_timeout = '5s';

ALTER TABLE payroll.fnf_settlements
  ADD COLUMN IF NOT EXISTS computed_by          UUID,
  ADD COLUMN IF NOT EXISTS submitted_by         UUID,
  ADD COLUMN IF NOT EXISTS submitted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finance_approved_by  UUID,
  ADD COLUMN IF NOT EXISTS finance_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disbursed_by         UUID,
  ADD COLUMN IF NOT EXISTS disbursed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_reference    VARCHAR(64),
  ADD COLUMN IF NOT EXISTS payment_date         DATE,
  ADD COLUMN IF NOT EXISTS rejected_by          UUID,
  ADD COLUMN IF NOT EXISTS rejected_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason     VARCHAR(512);

-- ---- status CHECK: widen (same drop + NOT VALID add + validate as 0047) ----
ALTER TABLE payroll.fnf_settlements
  DROP CONSTRAINT IF EXISTS fnf_settlements_status_check;

DO $$ BEGIN
  ALTER TABLE payroll.fnf_settlements
    ADD CONSTRAINT fnf_settlements_status_check
    CHECK (status IN (
      'draft', 'computed', 'submitted', 'finance_approved', 'disbursed', 'rejected',
      'approved', 'paid', 'cancelled'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payroll.fnf_settlements
  VALIDATE CONSTRAINT fnf_settlements_status_check;

-- ---- a disbursed settlement always records how it was paid ----------------
DO $$ BEGIN
  ALTER TABLE payroll.fnf_settlements
    ADD CONSTRAINT fnf_settlements_disbursed_payment_check
    CHECK (
      status <> 'disbursed'
      OR (payment_reference IS NOT NULL AND payment_date IS NOT NULL AND disbursed_by IS NOT NULL)
    )
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payroll.fnf_settlements
  VALIDATE CONSTRAINT fnf_settlements_disbursed_payment_check;
