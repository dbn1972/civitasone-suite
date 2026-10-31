-- Migration 0047: the receiving inventory store on a GRN.
--
-- UAT bundle 10 F95 (T6-07): procurement.grn.accepted carried no store, so
-- inventory-service could never post the stock receipt for an accepted GRN.
-- The GRN now records the store the goods are received into (optional; set at
-- GRN create) and the accepted event carries it.
--
-- Additive + idempotent; existing rows keep NULL. The table is already
-- FORCE RLS + granted.
-- Rollback:
--   ALTER TABLE grn.procurement_grns DROP COLUMN IF EXISTS store_id;
-- Affected services: procurement-service (grn module)

BEGIN;

SET lock_timeout = '5s';

ALTER TABLE grn.procurement_grns
  ADD COLUMN IF NOT EXISTS store_id UUID;

COMMIT;
