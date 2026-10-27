-- 0022_gst_invoice_series.sql
-- F11 (owner decision 2026-10-27, UAT B4): sequential GST tax-invoice numbers per supplier
-- GSTIN and financial year (April to March), consecutive, at most 16 characters (CGST
-- Rule 46), replacing the derived INV-YYYYMM-<hex> label. The number is allocated at ISSUE
-- time inside the issuing transaction from a locked counter row, so a rolled-back issue
-- hands its number back (no gaps) and concurrent issues serialize on the row lock.
-- The counter row is the supplier's legal series, shared across customer tenants, so it
-- carries NO tenant_id and no tenant data (supplier GSTIN, FY, counter only) and is not
-- under tenant RLS. Legacy issued rows keep invoice_number NULL and read as before.
-- Idempotent. Rollback: DROP INDEX uq_billing_invoices_series_no; ALTER TABLE
-- invoices.billing_invoices DROP COLUMN invoice_number, DROP COLUMN invoice_series;
-- DROP TABLE invoices.billing_invoice_series.
-- Affected services: billing-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS invoices.billing_invoice_series (
  supplier_gstin VARCHAR(15) NOT NULL,
  fiscal_year    CHAR(4)     NOT NULL,
  last_seq       BIGINT      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_gstin, fiscal_year),
  CONSTRAINT ck_billing_invoice_series_fy CHECK (fiscal_year ~ '^[0-9]{4}$'),
  CONSTRAINT ck_billing_invoice_series_seq CHECK (last_seq >= 0)
);

ALTER TABLE invoices.billing_invoices
  ADD COLUMN IF NOT EXISTS invoice_series VARCHAR(15),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(16);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_billing_invoices_number_format') THEN
    ALTER TABLE invoices.billing_invoices ADD CONSTRAINT ck_billing_invoices_number_format CHECK (
      invoice_number IS NULL OR (invoice_number ~ '^[A-Za-z0-9/-]{1,16}$' AND invoice_series IS NOT NULL)
    ) NOT VALID;
    ALTER TABLE invoices.billing_invoices VALIDATE CONSTRAINT ck_billing_invoices_number_format;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_invoices_series_no
  ON invoices.billing_invoices (invoice_series, invoice_number)
  WHERE invoice_number IS NOT NULL;
