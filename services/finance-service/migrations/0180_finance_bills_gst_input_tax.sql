-- 0180_finance_bills_gst_input_tax.sql
-- MSME commercial segment, slice M3a (docs/design/MSME-COMMERCIAL.md section 4, M3a). Additive, nullable / constant-default only
-- (metadata-only ADD COLUMN, no table rewrite). payments.finance_bills gains the GST input-tax capture of a vendor bill:
--   gst_lines              jsonb NULL      per-tax input lines [{gstType, ratePct, taxableMinor, taxMinor, hsnCode, itcCategory, blockCategory}]
--                                          (money as decimal strings). NULL on every govt / non-GST bill -> the posting path is unchanged.
--   supplier_gstin         varchar(15) NULL
--   rcm                    boolean NOT NULL DEFAULT false   reverse charge: the recipient (this tenant) pays the tax
--   rcm_category           text NULL       the configured RCM category the bill was accepted under (CA-flagged config; empty by default)
--   rcm_self_invoice_no    text NULL       gapless self-invoice number (RCM only)
-- Only a tenant with gl.finance_settings.gst_registered AND a non-govt coa_template can carry these (enforced in the consumer, not here).
-- Rollback: ALTER TABLE payments.finance_bills DROP COLUMN IF EXISTS gst_lines, DROP COLUMN IF EXISTS supplier_gstin,
--   DROP COLUMN IF EXISTS rcm, DROP COLUMN IF EXISTS rcm_category, DROP COLUMN IF EXISTS rcm_self_invoice_no;  (only while no bill carries GST).
SET lock_timeout = '5s';
ALTER TABLE payments.finance_bills ADD COLUMN IF NOT EXISTS gst_lines jsonb;
ALTER TABLE payments.finance_bills ADD COLUMN IF NOT EXISTS supplier_gstin varchar(15);
ALTER TABLE payments.finance_bills ADD COLUMN IF NOT EXISTS rcm boolean NOT NULL DEFAULT false;
ALTER TABLE payments.finance_bills ADD COLUMN IF NOT EXISTS rcm_category text;
ALTER TABLE payments.finance_bills ADD COLUMN IF NOT EXISTS rcm_self_invoice_no text;
