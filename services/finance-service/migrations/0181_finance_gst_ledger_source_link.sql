-- 0181_finance_gst_ledger_source_link.sql
-- MSME M3a: gl.finance_gst_ledger gains the source-document / journal link and the ITC categorisation, so a ledger row can be
-- tied to the GL voucher that carries the same tax and the ledger-vs-GL reconciliation is a join, not a guess. The table is EMPTY in
-- every environment (its producer was unwired), and every column is nullable or constant-default, so this is metadata-only.
--   source_doc_type    text  NULL   'bill' | 'sales_invoice' | ...   (part of the uniqueness key, see 0182)
--   source_doc_id      uuid  NULL   the source document (bill id)
--   journal_id         uuid  NULL   the GL journal that posted the same tax
--   ledger_voucher_no  text  NULL   that journal's voucher number (gl.finance_ledger.voucher_no)
--   itc_category       text  NULL   eligible | ineligible | blocked  (input rows only; CA-flagged config decides 'blocked')
--   rcm                boolean NOT NULL DEFAULT false
--   gl_head_code       text  NULL   the GL head that carries this tax (per-tax ITC head, or the RCM-pending head); NULL when the tax was
--                                   costed into the expense (ineligible / blocked) -- the reconciliation groups by this column
--   rcm_itc_claimed_at timestamptz NULL   set when the RCM tax was paid and the ITC moved from the pending head to the per-tax head
-- Rollback: DROP the columns below and the CHECK (only while no row relies on them).
SET lock_timeout = '5s';
ALTER TABLE gl.finance_gst_ledger ADD COLUMN IF NOT EXISTS source_doc_type text;
ALTER TABLE gl.finance_gst_ledger ADD COLUMN IF NOT EXISTS source_doc_id uuid;
ALTER TABLE gl.finance_gst_ledger ADD COLUMN IF NOT EXISTS journal_id uuid;
ALTER TABLE gl.finance_gst_ledger ADD COLUMN IF NOT EXISTS ledger_voucher_no text;
ALTER TABLE gl.finance_gst_ledger ADD COLUMN IF NOT EXISTS itc_category text;
ALTER TABLE gl.finance_gst_ledger ADD COLUMN IF NOT EXISTS rcm boolean NOT NULL DEFAULT false;
ALTER TABLE gl.finance_gst_ledger ADD COLUMN IF NOT EXISTS gl_head_code text;
ALTER TABLE gl.finance_gst_ledger ADD COLUMN IF NOT EXISTS rcm_itc_claimed_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_gst_ledger_itc_category_valid' AND conrelid = 'gl.finance_gst_ledger'::regclass) THEN
    ALTER TABLE gl.finance_gst_ledger ADD CONSTRAINT finance_gst_ledger_itc_category_valid
      CHECK (itc_category IS NULL OR itc_category IN ('eligible','ineligible','blocked')) NOT VALID;
  END IF;
END $$;
ALTER TABLE gl.finance_gst_ledger VALIDATE CONSTRAINT finance_gst_ledger_itc_category_valid;
