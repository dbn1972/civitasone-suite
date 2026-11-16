-- 0172_finance_grants_register.sql
-- Section 8 nonprofit finance, slice NF-3 (grants-in-aid; docs/design/SECTION8-NONPROFIT-FINANCE.md §2, §9, §10). ADDITIVE and
-- idempotent; dormant until a tenant's gl.finance_settings.fund_accounting is ON (every route / service op refuses while OFF), so
-- a govt tenant never writes a row here and its ledger is byte-identical.
--
--  1. gl.finance_settings.capital_grant_policy  per-tenant AS-12 policy: 'deferred_income' (DEFAULT: capital grant -> 2340 on
--                                receipt, reclassified to 2350 on capitalisation, released to 4450 with depreciation) or
--                                'capital_fund' (credited straight to the Capital Grant Fund 3300; no 2340/2350/4450 movement).
--                                The policy cannot change once a capital-grant posting exists (trigger below).
--  2. gl.grants                  grant / sanction register: one row per sanction, tied to ONE fund (composite tenant-scoped FK).
--  3. gl.grant_postings          append-only trail of the grant's money events (receipt / recognition / capitalisation / release),
--                                each pointing at the journal it posts; running totals are computed from it on read.
--  4. gl.grant_utilisation       per (grant, period) utilisation / UC tracking. The exact UC form number is NULLABLE and plain
--                                text (pluggable): the CA's GFR form answer lands later. interest_treatment is NULLABLE (CA to confirm).
-- Amounts are paise (bigint), like every other money column in gl.*.
-- DEPLOY ORDER: loadPostingSettingsTx selects capital_grant_policy on EVERY posting for EVERY tenant (govt included), so apply
--   this migration BEFORE rolling the finance-service image, or all postings fail (same precedent as 0170 fund_accounting).
-- Rollback (only while no grant exists): DROP TABLE gl.grant_utilisation, gl.grant_postings, gl.grants; drop the two functions
--   and the trigger on gl.finance_settings; ALTER TABLE gl.finance_settings DROP COLUMN IF EXISTS capital_grant_policy.

SET lock_timeout = '5s';

-- 1. Capital-grant policy -----------------------------------------------------------------------------------------------------
-- NOT NULL with a constant default is metadata-only (PG 11+): every existing row reads 'deferred_income'.
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS capital_grant_policy text NOT NULL DEFAULT 'deferred_income';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_settings_capital_grant_policy_check') THEN
    ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_capital_grant_policy_check
      CHECK (capital_grant_policy IN ('deferred_income', 'capital_fund')) NOT VALID;
  END IF;
END
$$;
ALTER TABLE gl.finance_settings VALIDATE CONSTRAINT finance_settings_capital_grant_policy_check;

-- 2. Grant / sanction register ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gl.grants (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL,
  fund_id                 uuid        NOT NULL,
  category                text        NOT NULL,
  grantor                 text        NOT NULL,
  scheme_code             text,
  sanction_ref            text        NOT NULL,
  sanction_date           date        NOT NULL,
  amount_sanctioned_minor bigint      NOT NULL,
  currency                char(3)     NOT NULL DEFAULT 'INR',
  status                  varchar(12) NOT NULL DEFAULT 'sanctioned',
  created_by              uuid        NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid        NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer     NOT NULL DEFAULT 1,
  CONSTRAINT grants_category_check CHECK (category IN ('salary', 'general', 'capital')),
  CONSTRAINT grants_status_check   CHECK (status IN ('sanctioned', 'active', 'closed')),
  CONSTRAINT grants_amount_check   CHECK (amount_sanctioned_minor > 0),
  CONSTRAINT grants_currency_check CHECK (currency = 'INR'),
  CONSTRAINT grants_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT grants_tenant_sanction_key UNIQUE (tenant_id, grantor, sanction_ref),
  -- composite tenant-scoped FK: a bare REFERENCES funds(id) would bypass RLS and could point at another tenant's fund
  CONSTRAINT grants_fund_fk FOREIGN KEY (tenant_id, fund_id) REFERENCES gl.funds (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_grants_tenant_fund ON gl.grants (tenant_id, fund_id);

-- 3. Money-event trail (append-only) ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gl.grant_postings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  grant_id     uuid        NOT NULL,
  kind         text        NOT NULL,
  amount_minor bigint      NOT NULL,
  posting_date date        NOT NULL,
  period       varchar(7)  NOT NULL,
  journal_id   uuid        NOT NULL,
  narration    text,
  created_by   uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_postings_kind_check   CHECK (kind IN ('receipt', 'recognition', 'capitalisation', 'release')),
  CONSTRAINT grant_postings_amount_check CHECK (amount_minor > 0),
  CONSTRAINT grant_postings_period_check CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT grant_postings_journal_key  UNIQUE (tenant_id, journal_id),
  CONSTRAINT grant_postings_grant_fk FOREIGN KEY (tenant_id, grant_id) REFERENCES gl.grants (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_grant_postings_grant ON gl.grant_postings (tenant_id, grant_id, kind);

-- 4. Utilisation / UC tracking ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gl.grant_utilisation (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  grant_id              uuid        NOT NULL,
  period                varchar(7)  NOT NULL,
  amount_utilised_minor bigint      NOT NULL DEFAULT 0,
  unspent_balance_minor bigint      NOT NULL DEFAULT 0,
  interest_earned_minor bigint      NOT NULL DEFAULT 0,
  interest_treatment    text,
  uc_form               text,
  uc_submitted_date     date,
  created_by            uuid        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid        NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_utilisation_period_check    CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT grant_utilisation_utilised_check  CHECK (amount_utilised_minor >= 0),
  CONSTRAINT grant_utilisation_interest_check  CHECK (interest_earned_minor >= 0),
  CONSTRAINT grant_utilisation_treatment_check CHECK (interest_treatment IS NULL OR interest_treatment IN ('remit', 'adjust', 'retain')),
  CONSTRAINT grant_utilisation_grant_period_key UNIQUE (tenant_id, grant_id, period),
  CONSTRAINT grant_utilisation_grant_fk FOREIGN KEY (tenant_id, grant_id) REFERENCES gl.grants (tenant_id, id)
);

-- RLS (ENABLE + FORCE, the standard tenant policy) + GRANT to finance_svc ------------------------------------------------------
ALTER TABLE gl.grants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.grants            FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.grant_postings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.grant_postings    FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.grant_utilisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.grant_utilisation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON gl.grants;
CREATE POLICY tenant_isolation_policy ON gl.grants
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.grant_postings;
CREATE POLICY tenant_isolation_policy ON gl.grant_postings
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.grant_utilisation;
CREATE POLICY tenant_isolation_policy ON gl.grant_utilisation
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT USAGE ON SCHEMA gl TO finance_svc;
    GRANT SELECT, INSERT, UPDATE ON gl.grants TO finance_svc;
    GRANT SELECT, INSERT ON gl.grant_postings TO finance_svc;          -- append-only: no UPDATE / DELETE
    GRANT SELECT, INSERT, UPDATE ON gl.grant_utilisation TO finance_svc;
  END IF;
END
$$;

-- Triggers --------------------------------------------------------------------------------------------------------------------
-- The trail is append-only even for a role that was granted more than finance_svc.
CREATE OR REPLACE FUNCTION gl.block_grant_posting_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'GRANT_POSTING_IMMUTABLE: gl.grant_postings is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_grant_postings_no_mutate ON gl.grant_postings;
CREATE TRIGGER trg_grant_postings_no_mutate BEFORE UPDATE OR DELETE ON gl.grant_postings
  FOR EACH ROW EXECUTE FUNCTION gl.block_grant_posting_mutation();

-- A grant's identity (tenant, fund, category, sanctioned amount) is immutable once it has a posting: the journals already
-- written are tagged to that fund under that category's heads.
CREATE OR REPLACE FUNCTION gl.guard_grant_immutable() RETURNS trigger AS $$
BEGIN
  IF (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.fund_id IS DISTINCT FROM OLD.fund_id
      OR NEW.category IS DISTINCT FROM OLD.category OR NEW.amount_sanctioned_minor IS DISTINCT FROM OLD.amount_sanctioned_minor)
     AND EXISTS (SELECT 1 FROM gl.grant_postings WHERE tenant_id = OLD.tenant_id AND grant_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'GRANT_LOCKED: grant % has postings; its fund, category and sanctioned amount can no longer change', OLD.sanction_ref
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_grant_immutable ON gl.grants;
CREATE TRIGGER trg_grant_immutable BEFORE UPDATE ON gl.grants
  FOR EACH ROW EXECUTE FUNCTION gl.guard_grant_immutable();

-- The capital-grant policy cannot change once a capital grant has any posting (receipts already sit on 2340 or 3300).
CREATE OR REPLACE FUNCTION gl.guard_capital_grant_policy() RETURNS trigger AS $$
BEGIN
  IF NEW.capital_grant_policy IS DISTINCT FROM OLD.capital_grant_policy
     AND EXISTS (SELECT 1 FROM gl.grant_postings p JOIN gl.grants g ON g.tenant_id = p.tenant_id AND g.id = p.grant_id
                  WHERE p.tenant_id = OLD.tenant_id AND g.category = 'capital' LIMIT 1) THEN
    RAISE EXCEPTION 'GRANT_POLICY_LOCKED: the capital-grant policy cannot change once a capital grant has postings'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_capital_grant_policy ON gl.finance_settings;
CREATE TRIGGER trg_capital_grant_policy BEFORE UPDATE OF capital_grant_policy ON gl.finance_settings
  FOR EACH ROW EXECUTE FUNCTION gl.guard_capital_grant_policy();
