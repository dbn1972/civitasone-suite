-- 0046_uat_g4_procurement_defects.sql
-- UAT DB read/write sweep 2026-10-28 (g4-procurement) -- schema fixes. Idempotent.
SET lock_timeout = '5s';

-- D1: a 2nd distinct central (CVC) debarment was acknowledged 202 but dead-lettered.
-- Every central row is written with vendor_id = NIL_UUID, so the one-active-row-per-(tenant, vendor)
-- unique index collided on the 2nd PAN. Central rows are identified by PAN, not by vendor: exclude
-- them from the per-vendor index and give them their own one-active-row-per-PAN unique index.
DROP INDEX IF EXISTS procurement.uq_vendor_blacklist_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_blacklist_active
  ON procurement.vendor_blacklist (tenant_id, vendor_id)
  WHERE status = 'active' AND scope <> 'central';
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_blacklist_central_pan_active
  ON procurement.vendor_blacklist (upper(pan))
  WHERE status = 'active' AND scope = 'central' AND pan IS NOT NULL;

-- D2: the POST /debit-notes consumer inserts status = 'issued' but 0015 only allowed 'draft', so the
-- row was never stored. A created debit note is an issued one; also allow cancellation.
ALTER TABLE payments.procurement_debit_notes DROP CONSTRAINT IF EXISTS procurement_debit_notes_status_check;
ALTER TABLE payments.procurement_debit_notes
  ADD CONSTRAINT procurement_debit_notes_status_check CHECK (status IN ('draft', 'issued', 'cancelled'));

-- D3: the UAT table pre-dated 0006 (CREATE TABLE IF NOT EXISTS skipped) and lacks tolerance_pct, which the
-- Drizzle model selects on every read -> GET list / findMatchById 500 and the consumer dead-lettered.
-- Re-assert every column the model declares so any drifted environment converges.
ALTER TABLE procurement.three_way_match
  ADD COLUMN IF NOT EXISTS tolerance_pct       NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS variance_pct        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS auto_matched        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qty_variance_pct    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS price_variance_pct  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS qty_tolerance_pct   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS price_tolerance_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS invoice_ref         VARCHAR(128),
  ADD COLUMN IF NOT EXISTS invoice_date        VARCHAR(32);

-- D4: PATCH /pos/:id/close set the status but dropped the closure timestamp and the officer note.
ALTER TABLE po.procurement_pos
  ADD COLUMN IF NOT EXISTS closed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closure_reason TEXT;

-- ROLLBACK (manual):
--   ALTER TABLE po.procurement_pos DROP COLUMN IF EXISTS closed_at, DROP COLUMN IF EXISTS closure_reason;
--   (the D1 index split and D2 constraint widening are safe to leave in place.)
