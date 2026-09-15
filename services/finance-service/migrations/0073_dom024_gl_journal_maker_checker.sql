-- Migration: DOM-024 — maker-checker for manual GL journal entries
--
-- Gap closed: POST /v1/finance/journals (manual journal entry) posted
-- straight to the ledger with no second-person approval — unlike every
-- other financial-posting flow in this codebase (sanctions R11, bills/
-- payments C4). A single finance_officer could create AND post a journal
-- entry unattended.
--
-- Fix (application-side, services/finance-service/src/modules/gl/*):
-- a manual journal now lands as `pending_approval` (created_by = maker) and
-- is NOT posted; a distinct checker calls
-- PATCH /v1/finance/journals/:id/approve to post it. Automated/system-
-- generated journals (GL-spine, depreciation, asset_disposal, payroll
-- settlement, reversal) are unaffected — they still post in one step via
-- gl/spine.ts / finance.gl.post, which this migration does not touch.
--
-- This migration only adjusts the schema/trigger to allow that new state:
--   1. `pending_approval` becomes a valid gl.finance_journals.status value.
--   2. Two additive, defaulted columns carry the maker's budget-override
--      request from draft through to posting (previously a transient,
--      message-payload-only flag — see DOM-007).
--   3. The value-immutability trigger (migration 0014) is extended to allow
--      the new pending_approval -> posted edge, and to allow voucher_no to
--      be finalized (AUTO placeholder -> the real gapless-allocated number)
--      ONLY on that one edge — gapless numbering is still allocated at
--      actual-posting time, never at draft time, so an abandoned/never-
--      approved draft cannot burn a voucher number (same invariant DOM-010
--      already protects on the single-step path).
--
-- Additive and idempotent throughout. No existing row's status changes; no
-- existing column is dropped, renamed, or narrowed.

SET lock_timeout = '5s';

-- ============================================================
-- 1. New status value
-- ============================================================
DO $$ BEGIN
  ALTER TABLE gl.finance_journals DROP CONSTRAINT IF EXISTS finance_journals_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE gl.finance_journals
  ADD CONSTRAINT finance_journals_status_check
  CHECK (status IN ('draft', 'pending_approval', 'posted', 'reversed'))
  NOT VALID;

ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT finance_journals_status_check;

-- ============================================================
-- 2. Carry the maker's budget-override request from draft to posting
-- ============================================================
ALTER TABLE gl.finance_journals
  ADD COLUMN IF NOT EXISTS budget_override boolean NOT NULL DEFAULT false;

ALTER TABLE gl.finance_journals
  ADD COLUMN IF NOT EXISTS override_reason text;

-- ============================================================
-- 3. Extend the value-immutability / status-transition trigger
--    (CREATE OR REPLACE — the trigger binding itself, from migration 0014,
--    is unchanged and does not need to be re-created)
-- ============================================================
CREATE OR REPLACE FUNCTION gl.block_journal_mutation() RETURNS trigger AS $$
DECLARE
  allowed_status_change boolean;
  is_maker_checker_finalize boolean;
BEGIN
  -- DOM-024: a manual journal drafted as pending_approval carries a
  -- placeholder voucher_no ('AUTO' or a caller-supplied string) until a
  -- distinct checker approves it; the real gapless sequential number is
  -- only allocated at that point (gl/consumer.ts postJournal()), exactly as
  -- it always was for the single-step automated posting path. This is the
  -- one legitimate case where voucher_no may change on UPDATE.
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

  -- Controlled status transitions:
  --   draft            -> posted   (legacy/automated single-step path)
  --   pending_approval -> posted   (DOM-024: a distinct checker approved)
  --   posted           -> reversed
  --   (no status change, e.g. touching reverses_id)
  allowed_status_change :=
       (OLD.status = 'draft'  AND NEW.status = 'posted')
    OR is_maker_checker_finalize
    OR (OLD.status = 'posted' AND NEW.status = 'reversed')
    OR (NEW.status = OLD.status);

  IF NOT allowed_status_change THEN
    RAISE EXCEPTION 'gl.finance_journals: illegal status transition % -> % (voucher %)', OLD.status, NEW.status, OLD.voucher_no;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
