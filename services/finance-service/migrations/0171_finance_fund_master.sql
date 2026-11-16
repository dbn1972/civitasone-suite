-- 0171_finance_fund_master.sql
-- Section 8 nonprofit finance, slice NF-1 (docs/design/SECTION8-NONPROFIT-FINANCE.md §2.3, §2.4, §9, §10): the fund master and
-- the fund dimension on the books of record. ADDITIVE and idempotent. Every new column is NULLABLE and every new check is a
-- strict no-op while fund_id is NULL, so a govt tenant (fund_accounting off, fund_id NULL on every row) behaves exactly as
-- before. NULL fund_id means GENERAL at READ time (gl.general_fund_id / COALESCE), never a missing bucket.
--
--  1. gl.funds                  fund master + RLS (ENABLE + FORCE, standard tenant policy) + GRANT; code/type/fcra are
--                               immutable once the fund has a ledger row (COA-template-lock style).
--  2. fund_id columns           gl.finance_ledger, gl.finance_journal_lines, gl.finance_opening_balances, gl.finance_cash_book
--                               (+ head_id on the cash book). Composite tenant-scoped FK (tenant_id, fund_id) -> gl.funds
--                               (tenant_id, id), added NOT VALID then VALIDATEd separately. A bare REFERENCES funds(id) would
--                               bypass RLS and could point at another tenant's fund -- never used.
--  3. opening balances          UNIQUE(tenant_id, fy_code, account_code) is replaced by a unique index that also keys on
--                               COALESCE(fund_id, zero-uuid): existing NULL rows cannot collide with each other.
--  4. journal types             + fund_transfer, fund_release, fund_year_end (the new maker-checker journals).
--  5. gl.check_journal_balance  EXTENDED: the per-journal debit = credit check is unchanged; a second check per
--                               (journal_id, fund_id) runs ONLY when at least one line of the journal has fund_id NOT NULL.
--                               The same single aggregate query counts fund_id, so a govt journal pays no extra query.
--  6. gl.general_fund_id / gl.resolve_fund   the one shared "NULL = GENERAL" resolver and the fail-closed write resolver.
--  7. gl.guard_fund_accounting_flip          the flag cannot flip while a manual draft is pending, and cannot go OFF once
--                               any fund-tagged ledger row exists (the append-only ledger makes that irreversible).
--  7b. gl.tag_fund_id trigger   BEFORE INSERT on finance_opening_balances / finance_cash_book: the fund seam for those two writers
--                               (gl.resolve_fund: OFF -> NULL, ON -> named fund or GENERAL, ON without GENERAL -> refused).
--  8. partial indexes           CREATE INDEX CONCURRENTLY ... WHERE fund_id IS NOT NULL (govt rows carry no index cost).
--                               There is deliberately NO plain (tenant_id, fund_id) index and NO gl.fund_balances table:
--                               balances are computed on read from the append-only ledger.
-- gl.finance_ledger stays append-only: ADD COLUMN is DDL and does not fire trg_ledger_no_mutate; no existing row is touched.
-- Rollback (only while no fund-tagged row exists): drop the indexes, triggers and functions below, drop the fund_id / head_id
--   columns and their FKs, restore UNIQUE(tenant_id, fy_code, account_code), DROP TABLE gl.funds, re-run 0159's type lists.

SET lock_timeout = '5s';

-- 1. Fund master ----------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gl.funds (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  code             varchar(32) NOT NULL,
  name             text        NOT NULL,
  type             varchar(16) NOT NULL,
  fcra             boolean     NOT NULL DEFAULT false,
  source_condition text,
  status           varchar(12) NOT NULL DEFAULT 'active',
  created_by       uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1,
  CONSTRAINT funds_type_check   CHECK (type IN ('corpus', 'restricted', 'unrestricted', 'designated')),
  CONSTRAINT funds_status_check CHECK (status IN ('active', 'closed')),
  CONSTRAINT funds_tenant_id_id_key   UNIQUE (tenant_id, id),
  CONSTRAINT funds_tenant_id_code_key UNIQUE (tenant_id, code)
);

ALTER TABLE gl.funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.funds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.funds;
CREATE POLICY tenant_isolation_policy ON gl.funds
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT USAGE ON SCHEMA gl TO finance_svc;
    GRANT SELECT, INSERT, UPDATE ON gl.funds TO finance_svc;
  END IF;
END
$$;

-- 2. fund_id on the books of record (nullable: metadata-only ADD COLUMN, no row rewrite) -----------------------------------
ALTER TABLE gl.finance_ledger          ADD COLUMN IF NOT EXISTS fund_id uuid;
ALTER TABLE gl.finance_journal_lines   ADD COLUMN IF NOT EXISTS fund_id uuid;
ALTER TABLE gl.finance_opening_balances ADD COLUMN IF NOT EXISTS fund_id uuid;
ALTER TABLE gl.finance_cash_book       ADD COLUMN IF NOT EXISTS fund_id uuid;
ALTER TABLE gl.finance_cash_book       ADD COLUMN IF NOT EXISTS head_id uuid;

-- Composite tenant-scoped FKs, NOT VALID first (no long scan under the lock), VALIDATEd separately. MATCH SIMPLE: a NULL
-- fund_id is not checked, so a govt row never references the fund master.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_ledger_fund_fk') THEN
    ALTER TABLE gl.finance_ledger ADD CONSTRAINT finance_ledger_fund_fk
      FOREIGN KEY (tenant_id, fund_id) REFERENCES gl.funds (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_journal_lines_fund_fk') THEN
    ALTER TABLE gl.finance_journal_lines ADD CONSTRAINT finance_journal_lines_fund_fk
      FOREIGN KEY (tenant_id, fund_id) REFERENCES gl.funds (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_opening_balances_fund_fk') THEN
    ALTER TABLE gl.finance_opening_balances ADD CONSTRAINT finance_opening_balances_fund_fk
      FOREIGN KEY (tenant_id, fund_id) REFERENCES gl.funds (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_cash_book_fund_fk') THEN
    ALTER TABLE gl.finance_cash_book ADD CONSTRAINT finance_cash_book_fund_fk
      FOREIGN KEY (tenant_id, fund_id) REFERENCES gl.funds (tenant_id, id) NOT VALID;
  END IF;
END
$$;

ALTER TABLE gl.finance_ledger           VALIDATE CONSTRAINT finance_ledger_fund_fk;
ALTER TABLE gl.finance_journal_lines    VALIDATE CONSTRAINT finance_journal_lines_fund_fk;
ALTER TABLE gl.finance_opening_balances VALIDATE CONSTRAINT finance_opening_balances_fund_fk;
ALTER TABLE gl.finance_cash_book        VALIDATE CONSTRAINT finance_cash_book_fund_fk;

-- 3. Opening balances: unique per (tenant, fy, account, fund). NULL fund rows (every existing row) key on the zero uuid. -------
CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_balances_tenant_fy_account_fund
  ON gl.finance_opening_balances (tenant_id, fy_code, account_code, COALESCE(fund_id, '00000000-0000-0000-0000-000000000000'::uuid));

DO $$
DECLARE c record;
BEGIN
  -- the original UNIQUE(tenant_id, fy_code, account_code) of 0022 (auto-named); found by definition, not by name
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'gl' AND rel.relname = 'finance_opening_balances' AND con.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(con.conkey) k
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k) = ARRAY['account_code', 'fy_code', 'tenant_id']
  LOOP
    EXECUTE format('ALTER TABLE gl.finance_opening_balances DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$$;

-- 4. Journal types for the new maker-checker journals (0159's list + 3). Strict superset: every existing row still satisfies it.
ALTER TABLE gl.finance_journals DROP CONSTRAINT IF EXISTS finance_journals_type_check;
ALTER TABLE gl.finance_journals
  ADD CONSTRAINT finance_journals_type_check
  CHECK (type IN (
    'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
    'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
    'payroll_accrual', 'payroll_settlement', 'depreciation', 'asset_disposal',
    'asset_acquisition', 'asset_impairment', 'asset_revaluation', 'asset_maintenance',
    'revenue_receipt', 'revenue_refund', 'billing_revenue_recognition', 'billing_cash_receipt',
    'asset_capitalization', 'lease_recognition', 'tds', 'adjustment', 'inventory_movement',
    'fund_transfer', 'fund_release', 'fund_year_end'
  )) NOT VALID;
ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT finance_journals_type_check;

ALTER TABLE gl.finance_journal_lines DROP CONSTRAINT IF EXISTS finance_journal_lines_journal_type_check;
ALTER TABLE gl.finance_journal_lines
  ADD CONSTRAINT finance_journal_lines_journal_type_check
  CHECK (journal_type IN (
    'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
    'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
    'payroll_accrual', 'payroll_settlement', 'depreciation', 'asset_disposal',
    'asset_acquisition', 'asset_impairment', 'asset_revaluation', 'asset_maintenance',
    'revenue_receipt', 'revenue_refund', 'billing_revenue_recognition', 'billing_cash_receipt',
    'asset_capitalization', 'lease_recognition', 'tds', 'adjustment', 'inventory_movement',
    'fund_transfer', 'fund_release', 'fund_year_end'
  )) NOT VALID;
ALTER TABLE gl.finance_journal_lines VALIDATE CONSTRAINT finance_journal_lines_journal_type_check;

-- 5. Per-fund balancing (design 2.4). Same signature and same first check as 0072b; the second check is gated by COUNT(fund_id)
--    taken from the SAME aggregate query, so a journal whose lines all have fund_id NULL (every govt journal) runs exactly the
--    query it ran before and returns. Lines with fund_id NULL inside a fund-tagged journal form their own group and must
--    balance too (the app tags every line when fund accounting is on, so this only guards hand-written SQL).
CREATE OR REPLACE FUNCTION gl.check_journal_balance(p_journal_id uuid) RETURNS void AS $$
DECLARE
  v_dr     bigint;
  v_cr     bigint;
  v_funded bigint;
  v_fund   uuid;
  v_fdr    bigint;
  v_fcr    bigint;
BEGIN
  SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0), COUNT(fund_id)
    INTO v_dr, v_cr, v_funded
    FROM gl.finance_journal_lines
   WHERE journal_id = p_journal_id;

  IF v_dr <> v_cr THEN
    RAISE EXCEPTION
      'JOURNAL_UNBALANCED: journal % lines do not balance (debit=%, credit=%)',
      p_journal_id, v_dr, v_cr
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_funded > 0 THEN
    SELECT fund_id, SUM(debit_minor), SUM(credit_minor)
      INTO v_fund, v_fdr, v_fcr
      FROM gl.finance_journal_lines
     WHERE journal_id = p_journal_id
     GROUP BY fund_id
    HAVING SUM(debit_minor) <> SUM(credit_minor)
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION
        'JOURNAL_FUND_UNBALANCED: journal % does not balance within fund % (debit=%, credit=%)',
        p_journal_id, COALESCE(v_fund::text, 'NULL'), v_fdr, v_fcr
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. NULL = GENERAL, resolved in one place ------------------------------------------------------------------------------------
-- gl.general_fund_id: the tenant's GENERAL fund id, or NULL when it does not exist (a tenant that never activated funds).
-- Every READ that buckets by fund uses COALESCE(fund_id, gl.general_fund_id(tenant_id)) so pre-flag history and govt tenants
-- resolve to GENERAL, never to a missing bucket. STABLE and RLS-scoped (runs as the invoker).
CREATE OR REPLACE FUNCTION gl.general_fund_id(p_tenant uuid) RETURNS uuid AS $$
  SELECT id FROM gl.funds WHERE tenant_id = p_tenant AND code = 'GENERAL' LIMIT 1
$$ LANGUAGE sql STABLE;

-- gl.resolve_fund: the WRITE-side resolver (used by cash-book writers; the posting path resolves the same rule in
-- gl/fund-context.ts). Fund accounting OFF -> NULL (and an explicit fund is refused). ON -> the explicit fund, else GENERAL;
-- ON with no GENERAL fund -> refused (design contract #5, fail-closed): never silently defaulted to an untagged row.
CREATE OR REPLACE FUNCTION gl.resolve_fund(p_tenant uuid, p_fund uuid) RETURNS uuid AS $$
DECLARE
  v_on boolean;
  v_id uuid;
BEGIN
  SELECT COALESCE(fund_accounting, false) INTO v_on FROM gl.finance_settings WHERE tenant_id = p_tenant;
  IF NOT COALESCE(v_on, false) THEN
    IF p_fund IS NOT NULL THEN
      RAISE EXCEPTION 'FUND_ACCOUNTING_DISABLED: a fund was given but fund accounting is off for this tenant'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END IF;
  IF p_fund IS NOT NULL THEN
    RETURN p_fund;
  END IF;
  v_id := gl.general_fund_id(p_tenant);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FUND_ACCOUNTING_NOT_READY: fund accounting is on but the GENERAL fund does not exist; refusing to write an untagged row'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. fcra / type / code are immutable once the fund has a ledger row (COA-template-lock style) --------------------------------
CREATE OR REPLACE FUNCTION gl.guard_fund_immutable() RETURNS trigger AS $$
BEGIN
  IF (NEW.fcra IS DISTINCT FROM OLD.fcra OR NEW.type IS DISTINCT FROM OLD.type OR NEW.code IS DISTINCT FROM OLD.code
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)
     AND EXISTS (SELECT 1 FROM gl.finance_ledger WHERE tenant_id = OLD.tenant_id AND fund_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'FUND_LOCKED: fund % has postings; its code, type and fcra flag can no longer change', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fund_immutable ON gl.funds;
CREATE TRIGGER trg_fund_immutable BEFORE UPDATE ON gl.funds
  FOR EACH ROW EXECUTE FUNCTION gl.guard_fund_immutable();

-- The fund_accounting flag cannot flip while a manual draft is pending (its fund state would be ambiguous: S5), and cannot go
-- OFF once any fund-tagged ledger row exists (design 9). A flip is rare; an unchanged value returns at once.
CREATE OR REPLACE FUNCTION gl.guard_fund_accounting_flip() RETURNS trigger AS $$
DECLARE
  v_old boolean;
  v_new boolean;
BEGIN
  v_old := CASE WHEN TG_OP = 'INSERT' THEN false ELSE COALESCE(OLD.fund_accounting, false) END;
  v_new := COALESCE(NEW.fund_accounting, false);
  IF v_old = v_new THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM gl.finance_journals WHERE tenant_id = NEW.tenant_id AND status = 'pending_approval' LIMIT 1) THEN
    RAISE EXCEPTION 'FUND_ACCOUNTING_FLIP_PENDING_DRAFTS: fund accounting cannot be switched while manual journals are pending approval; approve or reject them first'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_old AND NOT v_new
     AND EXISTS (SELECT 1 FROM gl.finance_ledger WHERE tenant_id = NEW.tenant_id AND fund_id IS NOT NULL LIMIT 1) THEN
    RAISE EXCEPTION 'FUND_ACCOUNTING_IRREVERSIBLE: fund accounting cannot be switched off once fund-tagged ledger rows exist'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fund_accounting_flip ON gl.finance_settings;
CREATE TRIGGER trg_fund_accounting_flip BEFORE INSERT OR UPDATE OF fund_accounting ON gl.finance_settings
  FOR EACH ROW EXECUTE FUNCTION gl.guard_fund_accounting_flip();

-- 7b. The fund seam for the two writers that are not the journal posting path (opening balances, cash book): a BEFORE INSERT
--     trigger resolves fund_id with gl.resolve_fund. Fund accounting OFF => NULL stays NULL (and a fund named while OFF is
--     refused); ON => the named fund, else GENERAL; ON with no GENERAL fund => refused (fail-closed). The cash-book head tag is
--     kept only when the row got a fund. Cost for govt: one primary-key lookup of the tenant's settings row per inserted row.
CREATE OR REPLACE FUNCTION gl.tag_fund_id() RETURNS trigger AS $$
BEGIN
  NEW.fund_id := gl.resolve_fund(NEW.tenant_id, NEW.fund_id);
  IF TG_TABLE_NAME = 'finance_cash_book' AND NEW.fund_id IS NULL THEN
    NEW.head_id := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_opening_balances_fund ON gl.finance_opening_balances;
CREATE TRIGGER trg_opening_balances_fund BEFORE INSERT ON gl.finance_opening_balances
  FOR EACH ROW EXECUTE FUNCTION gl.tag_fund_id();
DROP TRIGGER IF EXISTS trg_cash_book_fund ON gl.finance_cash_book;
CREATE TRIGGER trg_cash_book_fund BEFORE INSERT ON gl.finance_cash_book
  FOR EACH ROW EXECUTE FUNCTION gl.tag_fund_id();

-- 8. Partial indexes, built CONCURRENTLY (no write lock on the append-only ledger). Keep these LAST: CONCURRENTLY cannot run
--    inside a transaction block. Partial (WHERE fund_id IS NOT NULL) so govt tenants carry no index-maintenance cost.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fledger_fund_head_date
  ON gl.finance_ledger (tenant_id, fund_id, head_id, posting_date) WHERE fund_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_lines_fund_head_date
  ON gl.finance_journal_lines (tenant_id, fund_id, head_id, posting_date) WHERE fund_id IS NOT NULL;
