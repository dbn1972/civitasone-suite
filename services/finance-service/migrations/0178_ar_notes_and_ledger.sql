-- 0178_ar_notes_and_ledger.sql
-- MSME commercial M2, part 3 of 3: credit / debit notes (s.34 linkage to the original invoice) and the AR sub-ledger.
--
--  * ar.credit_debit_notes  one table, note_type credit | debit, always tied to an ISSUED invoice by a composite FK. The s.34
--                           time limit (30 November following the end of the financial year of the invoice) is computed at
--                           issue and STORED (s34_cutoff_date, within_s34_window) so the GST adjustment slice (M3b / M4) never
--                           recomputes it. VERIFY-by-CA: the earlier-of "annual return filed" limb is not tracked here.
--  * ar.ledger_entries      the AR sub-ledger for tenant sales: append-only (trigger), one debit-or-credit entry per invoice /
--                           note / advance adjustment, each tied to its invoice so the ageing report can net per invoice.
--                           gl.finance_ar_ledger (platform-billing AR) is NOT touched.
-- Rollback (only while empty): DROP TABLE ar.ledger_entries, ar.credit_debit_notes; drop the 2 functions.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS ar.credit_debit_notes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  note_no           varchar(16),
  note_type         varchar(6)  NOT NULL,
  status            varchar(10) NOT NULL DEFAULT 'draft',
  invoice_id        uuid        NOT NULL,
  customer_id       uuid        NOT NULL,
  note_date         date        NOT NULL,
  reason            varchar(40) NOT NULL,
  reason_text       text,
  supply_type       varchar(5)  NOT NULL,
  taxable_minor     bigint      NOT NULL,
  cgst_minor        bigint      NOT NULL DEFAULT 0,
  sgst_minor        bigint      NOT NULL DEFAULT 0,
  igst_minor        bigint      NOT NULL DEFAULT 0,
  cess_minor        bigint      NOT NULL DEFAULT 0,
  tax_minor         bigint      NOT NULL,
  total_minor       bigint      NOT NULL,
  s34_cutoff_date   date        NOT NULL,
  within_s34_window boolean     NOT NULL,
  journal_id        uuid,
  issued_at         timestamptz,
  issued_by         uuid,
  created_by        uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid        NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1,
  CONSTRAINT notes_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT notes_tenant_no_key    UNIQUE (tenant_id, note_no),
  CONSTRAINT notes_type_check   CHECK (note_type IN ('credit', 'debit')),
  CONSTRAINT notes_status_check CHECK (status IN ('draft', 'issued')),
  CONSTRAINT notes_no_format_check CHECK (note_no IS NULL OR note_no ~ '^[A-Z0-9/-]{1,16}$'),
  CONSTRAINT notes_issued_check CHECK (status = 'draft' OR (note_no IS NOT NULL AND journal_id IS NOT NULL AND issued_at IS NOT NULL)),
  CONSTRAINT notes_reason_check CHECK (reason IN ('sales_return', 'post_sale_discount', 'deficiency_in_service', 'correction_in_invoice',
                                                  'change_in_place_of_supply', 'finalisation_of_provisional_assessment', 'others')),
  CONSTRAINT notes_supply_check CHECK (supply_type IN ('intra', 'inter', 'none')),
  CONSTRAINT notes_amounts_check CHECK (taxable_minor >= 0 AND cgst_minor >= 0 AND sgst_minor >= 0 AND igst_minor >= 0 AND cess_minor >= 0),
  CONSTRAINT notes_tax_sum_check CHECK (tax_minor = cgst_minor + sgst_minor + igst_minor + cess_minor),
  CONSTRAINT notes_total_check   CHECK (taxable_minor + tax_minor = total_minor),
  CONSTRAINT notes_split_check CHECK (
    (supply_type = 'intra' AND igst_minor = 0) OR (supply_type = 'inter' AND cgst_minor = 0 AND sgst_minor = 0) OR (supply_type = 'none' AND tax_minor = 0))
);
CREATE INDEX IF NOT EXISTS idx_ar_notes_invoice ON ar.credit_debit_notes (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS ar.ledger_entries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  customer_id   uuid        NOT NULL,
  invoice_id    uuid        NOT NULL,
  entry_type    varchar(20) NOT NULL,
  source_doc_id uuid        NOT NULL,
  source_doc_no varchar(16) NOT NULL,
  entry_date    date        NOT NULL,
  due_date      date        NOT NULL,
  debit_minor   bigint      NOT NULL DEFAULT 0,
  credit_minor  bigint      NOT NULL DEFAULT 0,
  journal_id    uuid,
  created_by    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_source_key UNIQUE (tenant_id, entry_type, source_doc_id),
  -- 'receipt' is reserved for the customer-receipt slice; it is in the domain now so that slice needs no CHECK rewrite
  CONSTRAINT ledger_entries_type_check CHECK (entry_type IN ('invoice', 'debit_note', 'credit_note', 'advance_adjustment', 'receipt')),
  CONSTRAINT ledger_entries_amount_check CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);
CREATE INDEX IF NOT EXISTS idx_ar_ledger_customer ON ar.ledger_entries (tenant_id, customer_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_ar_ledger_invoice  ON ar.ledger_entries (tenant_id, invoice_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_invoice_fk') THEN
    ALTER TABLE ar.credit_debit_notes ADD CONSTRAINT notes_invoice_fk
      FOREIGN KEY (tenant_id, invoice_id) REFERENCES ar.sales_invoices (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_customer_fk') THEN
    ALTER TABLE ar.credit_debit_notes ADD CONSTRAINT notes_customer_fk
      FOREIGN KEY (tenant_id, customer_id) REFERENCES ar.customers (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_customer_fk') THEN
    ALTER TABLE ar.ledger_entries ADD CONSTRAINT ledger_entries_customer_fk
      FOREIGN KEY (tenant_id, customer_id) REFERENCES ar.customers (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_invoice_fk') THEN
    ALTER TABLE ar.ledger_entries ADD CONSTRAINT ledger_entries_invoice_fk
      FOREIGN KEY (tenant_id, invoice_id) REFERENCES ar.sales_invoices (tenant_id, id) NOT VALID;
  END IF;
END
$$;
ALTER TABLE ar.credit_debit_notes VALIDATE CONSTRAINT notes_invoice_fk;
ALTER TABLE ar.credit_debit_notes VALIDATE CONSTRAINT notes_customer_fk;
ALTER TABLE ar.ledger_entries     VALIDATE CONSTRAINT ledger_entries_customer_fk;
ALTER TABLE ar.ledger_entries     VALIDATE CONSTRAINT ledger_entries_invoice_fk;

ALTER TABLE ar.credit_debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar.credit_debit_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE ar.ledger_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar.ledger_entries     FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ar.credit_debit_notes;
CREATE POLICY tenant_isolation_policy ON ar.credit_debit_notes
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_policy ON ar.ledger_entries;
CREATE POLICY tenant_isolation_policy ON ar.ledger_entries
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ar.credit_debit_notes TO finance_svc;  -- the trigger below blocks non-draft rows
    GRANT SELECT, INSERT                 ON ar.ledger_entries     TO finance_svc;  -- append-only
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION ar.guard_note_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'NOTE_IMMUTABLE: note % is % and can no longer be changed', COALESCE(OLD.note_no, OLD.id::text), OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_note_immutable ON ar.credit_debit_notes;
CREATE TRIGGER trg_note_immutable BEFORE UPDATE OR DELETE ON ar.credit_debit_notes
  FOR EACH ROW EXECUTE FUNCTION ar.guard_note_immutable();

CREATE OR REPLACE FUNCTION ar.block_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AR_LEDGER_IMMUTABLE: ar.ledger_entries is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ar_ledger_no_mutate ON ar.ledger_entries;
CREATE TRIGGER trg_ar_ledger_no_mutate BEFORE UPDATE OR DELETE ON ar.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ar.block_ledger_mutation();
