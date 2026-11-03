-- 0157_gl_journal_reject.sql
-- UAT Phase 2 (J6): a checker can REJECT a manual journal waiting for approval (owner decision: rejection is FINAL).
--   * status 'rejected' is added to gl.finance_journals' status CHECK (last defined in 0073);
--   * pending_approval -> rejected becomes a permitted transition of gl.block_journal_mutation (last defined in 0073);
--   * a rejected journal is read-only: any later UPDATE of it is refused (kept unchanged for audit);
--   * rejection_reason (text) records why. Nothing is posted: no ledger line, no voucher number, no budget effect.
-- Guarded and idempotent: DROP CONSTRAINT IF EXISTS + ADD, ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Safe to re-run. Additive: the new status list is a strict superset of 0073's, so every existing row satisfies it.
-- Rollback (only while no row is 'rejected'): re-run section 1 and section 3 of 0073; the column may stay.

SET lock_timeout = '5s';

-- 1. Status CHECK: + 'rejected'
ALTER TABLE gl.finance_journals
  DROP CONSTRAINT IF EXISTS finance_journals_status_check;

ALTER TABLE gl.finance_journals
  ADD CONSTRAINT finance_journals_status_check
  CHECK (status IN ('draft', 'pending_approval', 'posted', 'reversed', 'rejected'))
  NOT VALID;

ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT finance_journals_status_check;

-- 2. Why the checker rejected it
ALTER TABLE gl.finance_journals
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 3. Value-immutability / status-transition trigger (the binding from 0014 is unchanged)
CREATE OR REPLACE FUNCTION gl.block_journal_mutation() RETURNS trigger AS $$
DECLARE
  allowed_status_change boolean;
  is_maker_checker_finalize boolean;
BEGIN
  -- A rejected journal is final and read-only for audit.
  IF OLD.status = 'rejected' THEN
    RAISE EXCEPTION 'gl.finance_journals: journal % was rejected and is read-only', OLD.id;
  END IF;

  -- DOM-024 (0073): voucher_no may change only when a pending draft is approved and gets its real number.
  is_maker_checker_finalize := (OLD.status = 'pending_approval' AND NEW.status = 'posted');

  IF NEW.tenant_id    IS DISTINCT FROM OLD.tenant_id
  OR (NEW.voucher_no  IS DISTINCT FROM OLD.voucher_no AND NOT is_maker_checker_finalize)
  OR NEW.type         IS DISTINCT FROM OLD.type
  OR NEW.posting_date IS DISTINCT FROM OLD.posting_date
  OR NEW.lines        IS DISTINCT FROM OLD.lines
  OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  OR NEW.created_by   IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'gl.finance_journals is immutable: amount/line/identity fields cannot change (voucher %)', OLD.voucher_no;
  END IF;

  -- rejection_reason is written only on the rejection edge.
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     AND NOT (OLD.status = 'pending_approval' AND NEW.status = 'rejected') THEN
    RAISE EXCEPTION 'gl.finance_journals: rejection_reason can only be set when a pending journal is rejected (voucher %)', OLD.voucher_no;
  END IF;

  -- Controlled status transitions:
  --   draft            -> posted    (legacy/automated single-step path)
  --   pending_approval -> posted    (DOM-024: a distinct checker approved)
  --   pending_approval -> rejected  (UAT P2: a distinct checker rejected; final)
  --   posted           -> reversed
  --   (no status change, e.g. touching reverses_id)
  allowed_status_change :=
       (OLD.status = 'draft'  AND NEW.status = 'posted')
    OR is_maker_checker_finalize
    OR (OLD.status = 'pending_approval' AND NEW.status = 'rejected')
    OR (OLD.status = 'posted' AND NEW.status = 'reversed')
    OR (NEW.status = OLD.status);

  IF NOT allowed_status_change THEN
    RAISE EXCEPTION 'gl.finance_journals: illegal status transition % -> % (voucher %)', OLD.status, NEW.status, OLD.voucher_no;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
