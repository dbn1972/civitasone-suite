-- Migration 0045: a PO to a vendor with no empanelment record carries its basis.
--
-- D4c #28 (GAP-PROCUREMENT-ORDERS-NEW-06, owner decision 2026-10-27): a purchase
-- order may go to a vendor with NO empanelment record (e.g. a tender winner)
-- only when it is linked to an awarded tender or a GeM order reference.
-- tender_id is the awarded tender (validated against tender.procurement_tenders:
-- same tenant, status awarded, awarded to this vendor); gem_order_ref is the GeM
-- order reference (free text). Both are recorded on the PO as the audit basis.
--
-- Additive + idempotent. Existing table is already FORCE RLS + granted.
-- Rollback:
--   ALTER TABLE po.procurement_pos DROP COLUMN IF EXISTS tender_id, DROP COLUMN IF EXISTS gem_order_ref;
-- Affected services: procurement-service (po module)

BEGIN;

SET lock_timeout = '5s';

ALTER TABLE po.procurement_pos
  ADD COLUMN IF NOT EXISTS tender_id     UUID,
  ADD COLUMN IF NOT EXISTS gem_order_ref TEXT;

COMMIT;
