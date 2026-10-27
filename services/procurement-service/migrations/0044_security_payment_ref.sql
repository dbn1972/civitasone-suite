-- Migration 0044: EMD / PBG dispositions record the treasury or PFMS payment
-- reference and the forfeiture order number.
--
-- D4c #26 (GAP-PROCUREMENT-EMD-BG-06, owner decision 2026-10-27): every EMD
-- refund and PBG release must carry the treasury / PFMS payment reference
-- (UTR, free text), and every forfeit the forfeiture order number (free text).
-- Existing role gates and audit are unchanged. Columns are nullable because
-- rows resolved before this migration have no reference; the API makes them
-- mandatory for every new disposition.
--
-- Additive + idempotent. Tables are already FORCE RLS + granted.
-- Rollback:
--   ALTER TABLE security.procurement_emd DROP COLUMN IF EXISTS payment_ref, DROP COLUMN IF EXISTS forfeiture_order_no;
--   ALTER TABLE security.procurement_pbg DROP COLUMN IF EXISTS payment_ref, DROP COLUMN IF EXISTS forfeiture_order_no;
-- Affected services: procurement-service (security module)

BEGIN;

SET lock_timeout = '5s';

ALTER TABLE security.procurement_emd
  ADD COLUMN IF NOT EXISTS payment_ref         TEXT,
  ADD COLUMN IF NOT EXISTS forfeiture_order_no TEXT;

ALTER TABLE security.procurement_pbg
  ADD COLUMN IF NOT EXISTS payment_ref         TEXT,
  ADD COLUMN IF NOT EXISTS forfeiture_order_no TEXT;

COMMIT;
