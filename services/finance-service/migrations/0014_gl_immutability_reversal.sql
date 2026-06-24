-- Migration 0014: GL spine hardening — journal immutability, reversal linkage,
-- and an Accounts-Payable control head so bills/payments can post double-entry.
-- Additive + idempotent only. The trigger/REVOKE section must run as the table
-- OWNER (civitas_admin) — but the tables are owned by finance_svc, so it works
-- as either owner; REVOKEs are applied against finance_svc explicitly.
--
-- IMMUTABILITY DESIGN (P0-2 / P0-3)
-- gl.finance_ledger is fully append-only: BEFORE UPDATE/DELETE and BEFORE
-- TRUNCATE all raise. Reversal NEVER touches existing ledger rows; it posts a
-- NEW mirror set of ledger lines.
-- gl.finance_journals is value-immutable but allows a CONTROLLED status-only
-- transition (draft -> posted -> reversed). The BEFORE UPDATE trigger rejects
-- any change to business fields (tenant_id, voucher_no, type, posting_date,
-- lines, amounts) and only permits an UPDATE that changes status along an
-- allowed edge (plus the bookkeeping columns updated_at/updated_by/version and
-- the additive reverses_id link). DELETE/TRUNCATE always raise. This lets the
-- /reverse endpoint mark the original 'reversed' through the allowed path while
-- still blocking amount/line mutation.

-- ============================================================
-- 1. Reversal linkage column (additive)
-- ============================================================
ALTER TABLE gl.finance_journals
  ADD COLUMN IF NOT EXISTS reverses_id uuid;

CREATE INDEX IF NOT EXISTS idx_fjournals_reverses ON gl.finance_journals (reverses_id);

-- ============================================================
-- 2. Accounts-Payable control head (seed, idempotent) per tenant.
--    Seeded for the demo/default tenant; production tenants get it via the
--    same code on first bill post if absent (consumer falls back to AP code).
-- ============================================================
INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, created_by, updated_by)
VALUES (
  'dddddddd-0001-0000-0000-000000002050'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  '2050', 'Accounts Payable (Control)', 1, 'liability',
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid
)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- 3. Ledger: fully append-only (block UPDATE / DELETE / TRUNCATE)
-- ============================================================
CREATE OR REPLACE FUNCTION gl.block_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gl.finance_ledger is append-only (% blocked on posted ledger)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_no_mutate ON gl.finance_ledger;
CREATE TRIGGER trg_ledger_no_mutate
  BEFORE UPDATE OR DELETE ON gl.finance_ledger
  FOR EACH ROW EXECUTE FUNCTION gl.block_ledger_mutation();

CREATE OR REPLACE FUNCTION gl.block_ledger_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gl.finance_ledger is append-only (TRUNCATE blocked)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_no_truncate ON gl.finance_ledger;
CREATE TRIGGER trg_ledger_no_truncate
  BEFORE TRUNCATE ON gl.finance_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION gl.block_ledger_truncate();

-- ============================================================
-- 4. Journals: value-immutable, status transition allowed
-- ============================================================
CREATE OR REPLACE FUNCTION gl.block_journal_mutation() RETURNS trigger AS $$
DECLARE
  allowed_status_change boolean;
BEGIN
  -- Business/amount fields are immutable on a posted journal.
  IF NEW.tenant_id    IS DISTINCT FROM OLD.tenant_id
  OR NEW.voucher_no   IS DISTINCT FROM OLD.voucher_no
  OR NEW.type         IS DISTINCT FROM OLD.type
  OR NEW.posting_date IS DISTINCT FROM OLD.posting_date
  OR NEW.lines        IS DISTINCT FROM OLD.lines
  OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  OR NEW.created_by   IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'gl.finance_journals is immutable: amount/line/identity fields cannot change (voucher %)', OLD.voucher_no;
  END IF;

  -- Only a controlled status transition is permitted: draft->posted->reversed.
  allowed_status_change :=
       (OLD.status = 'draft'  AND NEW.status = 'posted')
    OR (OLD.status = 'posted' AND NEW.status = 'reversed')
    OR (NEW.status = OLD.status);  -- no status change (e.g. touch reverses_id)

  IF NOT allowed_status_change THEN
    RAISE EXCEPTION 'gl.finance_journals: illegal status transition % -> % (voucher %)', OLD.status, NEW.status, OLD.voucher_no;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_no_mutate ON gl.finance_journals;
CREATE TRIGGER trg_journal_no_mutate
  BEFORE UPDATE ON gl.finance_journals
  FOR EACH ROW EXECUTE FUNCTION gl.block_journal_mutation();

CREATE OR REPLACE FUNCTION gl.block_journal_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gl.finance_journals cannot be deleted (voucher %)', OLD.voucher_no;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_no_delete ON gl.finance_journals;
CREATE TRIGGER trg_journal_no_delete
  BEFORE DELETE ON gl.finance_journals
  FOR EACH ROW EXECUTE FUNCTION gl.block_journal_delete();

CREATE OR REPLACE FUNCTION gl.block_journal_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gl.finance_journals cannot be truncated';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_no_truncate ON gl.finance_journals;
CREATE TRIGGER trg_journal_no_truncate
  BEFORE TRUNCATE ON gl.finance_journals
  FOR EACH STATEMENT EXECUTE FUNCTION gl.block_journal_truncate();

-- ============================================================
-- 5. REVOKE blunt mutation rights from the runtime role. The triggers are the
--    real enforcement (they fire for the owner too); the journals UPDATE right
--    is retained because the controlled status transition needs it, gated by
--    the trigger. Ledger loses UPDATE/DELETE entirely.
-- ============================================================
REVOKE UPDATE, DELETE, TRUNCATE ON gl.finance_ledger   FROM finance_svc;
REVOKE DELETE, TRUNCATE          ON gl.finance_journals FROM finance_svc;
-- keep INSERT + SELECT + UPDATE(status-only, trigger-gated) for journals:
GRANT  SELECT, INSERT, UPDATE    ON gl.finance_journals TO finance_svc;
GRANT  SELECT, INSERT            ON gl.finance_ledger   TO finance_svc;
