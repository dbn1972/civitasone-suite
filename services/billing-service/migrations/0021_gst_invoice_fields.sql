-- 0021_gst_invoice_fields.sql
-- GAP-TENANT-ADMIN-PLANS-04 / owner decision #26 (2026-10-26): a GST tax invoice carries the
-- supplier and recipient GSTIN, the place of supply, the CGST/SGST/IGST split (bigint minor
-- units) and an HSN/SAC code per line. All columns are NULLABLE / default 0 so every existing
-- invoice stays valid (legacy rows simply have no GST detail); CHECKs reject malformed values
-- and a split that does not add up to tax_minor.
-- RLS: columns only, no new table; the existing FORCE RLS policies on invoices.billing_invoices
-- and invoices.billing_invoice_items cover them.
-- Idempotent. Rollback: ALTER TABLE ... DROP COLUMN for each column added here.
-- Affected services: billing-service

SET lock_timeout = '5s';

ALTER TABLE invoices.billing_invoices
  ADD COLUMN IF NOT EXISTS supplier_gstin   VARCHAR(15),
  ADD COLUMN IF NOT EXISTS recipient_gstin  VARCHAR(15),
  ADD COLUMN IF NOT EXISTS place_of_supply  CHAR(2),
  ADD COLUMN IF NOT EXISTS cgst_minor       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_minor       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_minor       BIGINT NOT NULL DEFAULT 0;

ALTER TABLE invoices.billing_invoice_items
  ADD COLUMN IF NOT EXISTS hsn_sac VARCHAR(8);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_billing_invoices_gst_format') THEN
    ALTER TABLE invoices.billing_invoices ADD CONSTRAINT ck_billing_invoices_gst_format CHECK (
      (supplier_gstin  IS NULL OR supplier_gstin  ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
      AND (recipient_gstin IS NULL OR recipient_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
      AND (place_of_supply IS NULL OR place_of_supply ~ '^[0-9]{2}$')
    ) NOT VALID;
    ALTER TABLE invoices.billing_invoices VALIDATE CONSTRAINT ck_billing_invoices_gst_format;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_billing_invoices_gst_split') THEN
    ALTER TABLE invoices.billing_invoices ADD CONSTRAINT ck_billing_invoices_gst_split CHECK (
      cgst_minor >= 0 AND sgst_minor >= 0 AND igst_minor >= 0
      AND (cgst_minor + sgst_minor + igst_minor = 0 OR cgst_minor + sgst_minor + igst_minor = tax_minor)
    ) NOT VALID;
    ALTER TABLE invoices.billing_invoices VALIDATE CONSTRAINT ck_billing_invoices_gst_split;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_billing_invoice_items_hsn_sac') THEN
    ALTER TABLE invoices.billing_invoice_items ADD CONSTRAINT ck_billing_invoice_items_hsn_sac CHECK (
      hsn_sac IS NULL OR hsn_sac ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'
    ) NOT VALID;
    ALTER TABLE invoices.billing_invoice_items VALIDATE CONSTRAINT ck_billing_invoice_items_hsn_sac;
  END IF;
END $$;
