-- Migration 0049: GST rate and HSN/SAC code on a purchase-order line.
--
-- UAT ux-docs (T-DEVICE PDF review): an issued PO must show the GST split
-- (CGST + SGST within one State, IGST across States), the HSN/SAC of each
-- line and the amount in words. The split needs the rate of each line, which
-- the PO never recorded. Both columns are optional: a line without a rate is
-- printed as "GST rate not recorded" and no tax is invented for it.
-- gst_rate_bp is the rate in basis points (1800 = 18%). The database accepts 0-40%
-- (GST 2.0 has a 40% slab); the allowed slab list is enforced by the API
-- (po/validators.ts GST_ALLOWED_RATES_BP, configurable).
--
-- Additive + idempotent; existing rows keep NULL. The table is already
-- FORCE RLS + granted.
-- Rollback:
--   ALTER TABLE po.procurement_po_items
--     DROP CONSTRAINT IF EXISTS procurement_po_items_gst_rate_bp_check,
--     DROP COLUMN IF EXISTS gst_rate_bp,
--     DROP COLUMN IF EXISTS hsn_sac;
-- Affected services: procurement-service (po module)

BEGIN;

SET lock_timeout = '5s';

ALTER TABLE po.procurement_po_items
  ADD COLUMN IF NOT EXISTS gst_rate_bp INTEGER,
  ADD COLUMN IF NOT EXISTS hsn_sac VARCHAR(8);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_po_items_gst_rate_bp_check'
       AND conrelid = 'po.procurement_po_items'::regclass
  ) THEN
    ALTER TABLE po.procurement_po_items
      ADD CONSTRAINT procurement_po_items_gst_rate_bp_check
      CHECK (gst_rate_bp IS NULL OR gst_rate_bp BETWEEN 0 AND 4000);
  END IF;
END $$;

COMMIT;
