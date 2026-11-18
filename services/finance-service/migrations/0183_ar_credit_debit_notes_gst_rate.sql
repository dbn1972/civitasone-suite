-- 0183_ar_credit_debit_notes_gst_rate.sql
-- MSME M3b: a credit / debit note must post its GST output rows per rate (gl.finance_gst_ledger keeps one row per tax type and rate),
-- but the note stored only the computed CGST / SGST / IGST, not the rate it was computed at (a multi-rate invoice cannot be re-derived).
-- Nullable, metadata-only (no default, no rewrite). A note with tax and a NULL rate is refused at issue.
-- Rollback: ALTER TABLE ar.credit_debit_notes DROP COLUMN IF EXISTS gst_rate_pct;
SET lock_timeout = '5s';
ALTER TABLE ar.credit_debit_notes ADD COLUMN IF NOT EXISTS gst_rate_pct numeric(5,2);
