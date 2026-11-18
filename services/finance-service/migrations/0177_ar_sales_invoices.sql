-- 0177_ar_sales_invoices.sql
-- MSME commercial M2, part 2 of 3: sales invoice header + lines and the advance-receipt voucher register (NEW `ar` schema).
-- See 0176 for the table spec every ar table follows.
--
--  * ar.sales_invoices      header. REGULAR GST only (no composition / bill-of-supply branch this version). The CGST / SGST / IGST
--                           split is computed by @civitasone/gst at draft time and STORED here so the GST output posting (slice M3b)
--                           and GSTR-1 (M4) read it without recomputing. invoice_no is NULL while draft and allocated gaplessly
--                           (Rule 46: <= 16 chars, [A-Z0-9/-]) at issue. Status draft -> issued; the immutability trigger blocks
--                           every UPDATE / DELETE once status <> 'draft' (a correction is a credit / debit note, s.34).
--  * ar.sales_invoice_lines HSN/SAC, qty, rate, effective-dated GST rate (links the rate-master row used). Lines of a non-draft
--                           invoice are immutable too.
--  * ar.advance_receipts    Rule 50 receipt vouchers for advances; whole receipts are adjusted against an invoice at issue.
-- Rollback (only while no invoice exists): DROP TABLE ar.advance_receipts, ar.sales_invoice_lines, ar.sales_invoices; drop the 2 functions.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS ar.sales_invoices (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  invoice_no            varchar(16),
  status                varchar(10) NOT NULL DEFAULT 'draft',
  customer_id           uuid        NOT NULL,
  customer_name         text        NOT NULL,
  customer_gstin        varchar(15),
  supplier_gstin        varchar(15),
  invoice_date          date        NOT NULL,
  supply_date           date        NOT NULL,
  time_of_supply        date        NOT NULL,
  due_date              date        NOT NULL,
  place_of_supply       char(2)     NOT NULL,
  supply_type           varchar(5)  NOT NULL,
  invoice_type          varchar(3)  NOT NULL,
  reverse_charge        boolean     NOT NULL DEFAULT false,
  currency              char(3)     NOT NULL DEFAULT 'INR',
  taxable_minor         bigint      NOT NULL,
  cgst_minor            bigint      NOT NULL DEFAULT 0,
  sgst_minor            bigint      NOT NULL DEFAULT 0,
  igst_minor            bigint      NOT NULL DEFAULT 0,
  cess_minor            bigint      NOT NULL DEFAULT 0,
  tax_minor             bigint      NOT NULL,
  total_minor           bigint      NOT NULL,
  advance_adjusted_minor bigint     NOT NULL DEFAULT 0,
  narration             text,
  journal_id            uuid,
  issued_at             timestamptz,
  issued_by             uuid,
  source                varchar(8)  NOT NULL DEFAULT 'api',
  client_ref            text,
  created_by            uuid        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid        NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer     NOT NULL DEFAULT 1,
  CONSTRAINT sales_invoices_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT sales_invoices_tenant_no_key    UNIQUE (tenant_id, invoice_no),
  CONSTRAINT sales_invoices_tenant_client_key UNIQUE (tenant_id, client_ref),
  CONSTRAINT sales_invoices_status_check CHECK (status IN ('draft', 'issued')),
  CONSTRAINT sales_invoices_no_format_check CHECK (invoice_no IS NULL OR invoice_no ~ '^[A-Z0-9/-]{1,16}$'),
  CONSTRAINT sales_invoices_issued_check CHECK (status = 'draft' OR (invoice_no IS NOT NULL AND journal_id IS NOT NULL AND issued_at IS NOT NULL)),
  CONSTRAINT sales_invoices_supply_type_check CHECK (supply_type IN ('intra', 'inter', 'none')),
  CONSTRAINT sales_invoices_type_check   CHECK (invoice_type IN ('B2B', 'B2C')),
  CONSTRAINT sales_invoices_source_check CHECK (source IN ('api', 'mobile')),
  CONSTRAINT sales_invoices_currency_check CHECK (currency = 'INR'),
  CONSTRAINT sales_invoices_gstin_check CHECK (
    (customer_gstin IS NULL OR customer_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
    AND (supplier_gstin IS NULL OR supplier_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')),
  CONSTRAINT sales_invoices_pos_check CHECK (place_of_supply ~ '^[0-9]{2}$'),
  CONSTRAINT sales_invoices_dates_check CHECK (due_date >= invoice_date AND time_of_supply <= invoice_date),
  CONSTRAINT sales_invoices_amounts_check CHECK (
    taxable_minor >= 0 AND cgst_minor >= 0 AND sgst_minor >= 0 AND igst_minor >= 0 AND cess_minor >= 0
    AND advance_adjusted_minor >= 0 AND advance_adjusted_minor <= total_minor),
  CONSTRAINT sales_invoices_tax_sum_check   CHECK (tax_minor = cgst_minor + sgst_minor + igst_minor + cess_minor),
  CONSTRAINT sales_invoices_total_check     CHECK (taxable_minor + tax_minor = total_minor),
  -- the head rule stored with the document: intra-state = CGST + SGST only, inter-state = IGST only, none = no GST at all
  CONSTRAINT sales_invoices_split_check CHECK (
    (supply_type = 'intra' AND igst_minor = 0)
    OR (supply_type = 'inter' AND cgst_minor = 0 AND sgst_minor = 0)
    OR (supply_type = 'none' AND tax_minor = 0)),
  CONSTRAINT sales_invoices_b2b_check CHECK (invoice_type = 'B2C' OR customer_gstin IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ar_sales_invoices_customer ON ar.sales_invoices (tenant_id, customer_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_ar_sales_invoices_status   ON ar.sales_invoices (tenant_id, status, invoice_date);

CREATE TABLE IF NOT EXISTS ar.sales_invoice_lines (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL,
  invoice_id         uuid          NOT NULL,
  line_no            smallint      NOT NULL,
  description        text          NOT NULL,
  hsn_sac            varchar(8),
  qty                numeric(14,3) NOT NULL,
  uom                varchar(8),
  rate_minor         bigint        NOT NULL,
  discount_minor     bigint        NOT NULL DEFAULT 0,
  taxable_minor      bigint        NOT NULL,
  gst_rate_pct       numeric(5,2)  NOT NULL DEFAULT 0,
  gst_rate_master_id uuid,
  tax_minor          bigint        NOT NULL,
  total_minor        bigint        NOT NULL,
  CONSTRAINT sales_invoice_lines_key UNIQUE (tenant_id, invoice_id, line_no),
  CONSTRAINT sales_invoice_lines_qty_check CHECK (qty > 0),
  CONSTRAINT sales_invoice_lines_amounts_check CHECK (rate_minor >= 0 AND discount_minor >= 0 AND taxable_minor >= 0 AND tax_minor >= 0),
  CONSTRAINT sales_invoice_lines_rate_check CHECK (gst_rate_pct >= 0 AND gst_rate_pct <= 100),
  CONSTRAINT sales_invoice_lines_total_check CHECK (taxable_minor + tax_minor = total_minor),
  CONSTRAINT sales_invoice_lines_hsn_check CHECK (hsn_sac IS NULL OR hsn_sac ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$')
);
CREATE INDEX IF NOT EXISTS idx_ar_sales_invoice_lines_invoice ON ar.sales_invoice_lines (tenant_id, invoice_id);

-- Rule 50 receipt voucher for an advance (whole receipts are adjusted against an invoice at issue). VERIFY-by-CA: whether tax
-- is payable on advances for goods (notified exemption) is the CA's call; the rate is supplied per receipt, 0 allowed.
CREATE TABLE IF NOT EXISTS ar.advance_receipts (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  receipt_no           varchar(16) NOT NULL,
  customer_id          uuid        NOT NULL,
  receipt_date         date        NOT NULL,
  place_of_supply      char(2)     NOT NULL,
  supply_type          varchar(5)  NOT NULL,
  amount_minor         bigint      NOT NULL,
  gst_rate_pct         numeric(5,2) NOT NULL DEFAULT 0,
  taxable_minor        bigint      NOT NULL,
  cgst_minor           bigint      NOT NULL DEFAULT 0,
  sgst_minor           bigint      NOT NULL DEFAULT 0,
  igst_minor           bigint      NOT NULL DEFAULT 0,
  tax_minor            bigint      NOT NULL,
  payment_mode         varchar(16),
  reference            text,
  status               varchar(10) NOT NULL DEFAULT 'open',
  adjusted_invoice_id  uuid,
  created_by           uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid        NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT advance_receipts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT advance_receipts_tenant_no_key    UNIQUE (tenant_id, receipt_no),
  CONSTRAINT advance_receipts_status_check CHECK (status IN ('open', 'adjusted')),
  CONSTRAINT advance_receipts_adjusted_check CHECK ((status = 'adjusted') = (adjusted_invoice_id IS NOT NULL)),
  CONSTRAINT advance_receipts_supply_check CHECK (supply_type IN ('intra', 'inter', 'none')),
  CONSTRAINT advance_receipts_amount_check CHECK (amount_minor > 0 AND taxable_minor >= 0 AND tax_minor >= 0),
  CONSTRAINT advance_receipts_total_check CHECK (taxable_minor + tax_minor = amount_minor),
  CONSTRAINT advance_receipts_tax_sum_check CHECK (tax_minor = cgst_minor + sgst_minor + igst_minor),
  CONSTRAINT advance_receipts_split_check CHECK (
    (supply_type = 'intra' AND igst_minor = 0) OR (supply_type = 'inter' AND cgst_minor = 0 AND sgst_minor = 0) OR (supply_type = 'none' AND tax_minor = 0)),
  CONSTRAINT advance_receipts_no_format_check CHECK (receipt_no ~ '^[A-Z0-9/-]{1,16}$')
);
CREATE INDEX IF NOT EXISTS idx_ar_advance_receipts_customer ON ar.advance_receipts (tenant_id, customer_id, status);

-- Composite tenant-scoped FKs: NOT VALID, then VALIDATE (a bare REFERENCES id would bypass RLS) -------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_customer_fk') THEN
    ALTER TABLE ar.sales_invoices ADD CONSTRAINT sales_invoices_customer_fk
      FOREIGN KEY (tenant_id, customer_id) REFERENCES ar.customers (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_pos_fk') THEN
    ALTER TABLE ar.sales_invoices ADD CONSTRAINT sales_invoices_pos_fk
      FOREIGN KEY (place_of_supply) REFERENCES gl.finance_gst_state_codes (code) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_lines_invoice_fk') THEN
    ALTER TABLE ar.sales_invoice_lines ADD CONSTRAINT sales_invoice_lines_invoice_fk
      FOREIGN KEY (tenant_id, invoice_id) REFERENCES ar.sales_invoices (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_lines_hsn_fk') THEN
    ALTER TABLE ar.sales_invoice_lines ADD CONSTRAINT sales_invoice_lines_hsn_fk
      FOREIGN KEY (hsn_sac) REFERENCES gl.finance_hsn_sac_master (code) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_lines_rate_fk') THEN
    ALTER TABLE ar.sales_invoice_lines ADD CONSTRAINT sales_invoice_lines_rate_fk
      FOREIGN KEY (gst_rate_master_id) REFERENCES gl.finance_gst_rate_master (id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_receipts_customer_fk') THEN
    ALTER TABLE ar.advance_receipts ADD CONSTRAINT advance_receipts_customer_fk
      FOREIGN KEY (tenant_id, customer_id) REFERENCES ar.customers (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_receipts_invoice_fk') THEN
    ALTER TABLE ar.advance_receipts ADD CONSTRAINT advance_receipts_invoice_fk
      FOREIGN KEY (tenant_id, adjusted_invoice_id) REFERENCES ar.sales_invoices (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_receipts_pos_fk') THEN
    ALTER TABLE ar.advance_receipts ADD CONSTRAINT advance_receipts_pos_fk
      FOREIGN KEY (place_of_supply) REFERENCES gl.finance_gst_state_codes (code) NOT VALID;
  END IF;
END
$$;
ALTER TABLE ar.sales_invoices      VALIDATE CONSTRAINT sales_invoices_customer_fk;
ALTER TABLE ar.sales_invoices      VALIDATE CONSTRAINT sales_invoices_pos_fk;
ALTER TABLE ar.sales_invoice_lines VALIDATE CONSTRAINT sales_invoice_lines_invoice_fk;
ALTER TABLE ar.sales_invoice_lines VALIDATE CONSTRAINT sales_invoice_lines_hsn_fk;
ALTER TABLE ar.sales_invoice_lines VALIDATE CONSTRAINT sales_invoice_lines_rate_fk;
ALTER TABLE ar.advance_receipts    VALIDATE CONSTRAINT advance_receipts_customer_fk;
ALTER TABLE ar.advance_receipts    VALIDATE CONSTRAINT advance_receipts_invoice_fk;
ALTER TABLE ar.advance_receipts    VALIDATE CONSTRAINT advance_receipts_pos_fk;

-- RLS ---------------------------------------------------------------------------------------------------------------------------
ALTER TABLE ar.sales_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar.sales_invoices      FORCE ROW LEVEL SECURITY;
ALTER TABLE ar.sales_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar.sales_invoice_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE ar.advance_receipts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar.advance_receipts    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ar.sales_invoices;
CREATE POLICY tenant_isolation_policy ON ar.sales_invoices
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_policy ON ar.sales_invoice_lines;
CREATE POLICY tenant_isolation_policy ON ar.sales_invoice_lines
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_policy ON ar.advance_receipts;
CREATE POLICY tenant_isolation_policy ON ar.advance_receipts
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ar.sales_invoices      TO finance_svc;  -- the trigger below blocks non-draft rows
    GRANT SELECT, INSERT, UPDATE, DELETE ON ar.sales_invoice_lines TO finance_svc;
    GRANT SELECT, INSERT, UPDATE         ON ar.advance_receipts    TO finance_svc;
  END IF;
END
$$;

-- Immutability -----------------------------------------------------------------------------------------------------------------
-- A tax invoice is a statutory document: once issued it can never be edited or deleted (correct it by a credit / debit note).
-- Only a DRAFT row may be updated (including the draft -> issued transition itself) or deleted.
CREATE OR REPLACE FUNCTION ar.guard_sales_invoice_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'SALES_INVOICE_IMMUTABLE: invoice % is % and can no longer be changed; issue a credit or debit note', COALESCE(OLD.invoice_no, OLD.id::text), OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sales_invoice_immutable ON ar.sales_invoices;
CREATE TRIGGER trg_sales_invoice_immutable BEFORE UPDATE OR DELETE ON ar.sales_invoices
  FOR EACH ROW EXECUTE FUNCTION ar.guard_sales_invoice_immutable();

CREATE OR REPLACE FUNCTION ar.guard_sales_invoice_line_immutable() RETURNS trigger AS $$
DECLARE parent_status varchar(10);
        parent_id uuid;
        parent_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN parent_id := OLD.invoice_id; parent_tenant := OLD.tenant_id;
  ELSE parent_id := NEW.invoice_id; parent_tenant := NEW.tenant_id; END IF;
  SELECT status INTO parent_status FROM ar.sales_invoices WHERE tenant_id = parent_tenant AND id = parent_id;
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'SALES_INVOICE_IMMUTABLE: the lines of an issued invoice can no longer be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sales_invoice_line_immutable ON ar.sales_invoice_lines;
CREATE TRIGGER trg_sales_invoice_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON ar.sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION ar.guard_sales_invoice_line_immutable();

-- An advance receipt voucher is immutable except the single open -> adjusted transition (which only sets status + the invoice).
CREATE OR REPLACE FUNCTION ar.guard_advance_receipt() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'adjusted' THEN
    RAISE EXCEPTION 'ADVANCE_RECEIPT_IMMUTABLE: receipt % is already adjusted', OLD.receipt_no USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.receipt_no IS DISTINCT FROM OLD.receipt_no OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date THEN
    RAISE EXCEPTION 'ADVANCE_RECEIPT_IMMUTABLE: only the adjustment of receipt % may change', OLD.receipt_no USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_advance_receipt_guard ON ar.advance_receipts;
CREATE TRIGGER trg_advance_receipt_guard BEFORE UPDATE ON ar.advance_receipts
  FOR EACH ROW EXECUTE FUNCTION ar.guard_advance_receipt();
