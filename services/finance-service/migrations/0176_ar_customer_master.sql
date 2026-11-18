-- 0176_ar_customer_master.sql
-- MSME commercial M2 (docs/design/MSME-COMMERCIAL.md section 3), part 1 of 3: the NEW `ar` schema, the customer master and the
-- gapless document-counter table. ADDITIVE and dormant: nothing here is read until a tenant whose stored coa_template is not
-- `govt` calls the (centrally gated) sales routes, so a govt tenant never gets a row and its ledger is byte-identical.
--
-- AR DESIGN (option b, owner-locked): tenant sales AR lives in this NEW `ar` schema. gl.finance_ar_ledger (platform-billing AR,
-- source = billing_event / opening_import) is NOT touched by any M2 migration.
--
-- Every table in the `ar` schema: tenant_id NOT NULL; ENABLE + FORCE RLS; tenant_isolation_policy USING + WITH CHECK;
-- UNIQUE(tenant_id, <code/no>); composite (tenant_id, fk) foreign keys added NOT VALID then VALIDATE under lock_timeout;
-- money is BIGINT minor units (paise) with CHECK(taxable + tax = total) on every document.
-- New tables are empty, so no CREATE INDEX CONCURRENTLY file is needed (plain indexes are lock-safe on an empty table).
--
-- Rollback (only while no customer exists): DROP TABLE ar.doc_counters, ar.customers; DROP SCHEMA ar (after 0177/0178 rolled back).

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS ar;

CREATE TABLE IF NOT EXISTS ar.customers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  customer_code      varchar(32) NOT NULL,
  name               text        NOT NULL,
  gstin              varchar(15),
  state_code         char(2)     NOT NULL,
  pan                varchar(10),
  address            text,
  email              text,
  phone              text,
  credit_days        integer     NOT NULL DEFAULT 0,
  credit_limit_minor bigint,
  is_active          boolean     NOT NULL DEFAULT true,
  created_by         uuid        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer     NOT NULL DEFAULT 1,
  CONSTRAINT customers_tenant_code_key UNIQUE (tenant_id, customer_code),
  CONSTRAINT customers_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT customers_name_check   CHECK (length(btrim(name)) > 0),
  CONSTRAINT customers_gstin_check  CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  CONSTRAINT customers_pan_check    CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT customers_state_check  CHECK (state_code ~ '^[0-9]{2}$'),
  -- a GSTIN's first two digits are its state; chars 3-12 are the PAN
  CONSTRAINT customers_gstin_state_check CHECK (gstin IS NULL OR substr(gstin, 1, 2) = state_code),
  CONSTRAINT customers_gstin_pan_check   CHECK (gstin IS NULL OR pan IS NULL OR substr(gstin, 3, 10) = pan),
  CONSTRAINT customers_credit_days_check  CHECK (credit_days BETWEEN 0 AND 365),
  CONSTRAINT customers_credit_limit_check CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ar_customers_tenant_name ON ar.customers (tenant_id, lower(name));

-- Gapless per-tenant document counters (packages/numbering allocateGaplessSeq: one row lock, no gaps, no duplicates).
CREATE TABLE IF NOT EXISTS ar.doc_counters (
  tenant_id  uuid        NOT NULL,
  doc_type   varchar(24) NOT NULL,
  bucket     varchar(16) NOT NULL,
  last_seq   bigint      NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, doc_type, bucket),
  CONSTRAINT doc_counters_seq_check CHECK (last_seq >= 0)
);

-- Composite FKs: NOT VALID then VALIDATE (the referenced masters are global reference tables from 0175).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_state_fk') THEN
    ALTER TABLE ar.customers ADD CONSTRAINT customers_state_fk
      FOREIGN KEY (state_code) REFERENCES gl.finance_gst_state_codes (code) NOT VALID;
  END IF;
END
$$;
ALTER TABLE ar.customers VALIDATE CONSTRAINT customers_state_fk;

-- RLS ---------------------------------------------------------------------------------------------------------------------------
ALTER TABLE ar.customers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar.customers    FORCE ROW LEVEL SECURITY;
ALTER TABLE ar.doc_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar.doc_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ar.customers;
CREATE POLICY tenant_isolation_policy ON ar.customers
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_policy ON ar.doc_counters;
CREATE POLICY tenant_isolation_policy ON ar.doc_counters
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT USAGE ON SCHEMA ar TO finance_svc;
    GRANT SELECT, INSERT, UPDATE ON ar.customers    TO finance_svc;
    GRANT SELECT, INSERT, UPDATE ON ar.doc_counters TO finance_svc;
    -- the statutory masters (0175) are read by the invoice service; idempotent
    GRANT SELECT ON gl.finance_gst_rate_master, gl.finance_hsn_sac_master, gl.finance_gst_state_codes TO finance_svc;
  END IF;
END
$$;
