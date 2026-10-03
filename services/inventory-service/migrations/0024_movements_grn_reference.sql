-- 0024_movements_grn_reference.sql
--
-- GAP-INVENTORY-RECEIPTS-03: a receipt posted from an accepted GRN carries the
-- human-readable GRN number, the purchase-order reference and the supplier id,
-- copied from procurement-service at post time (cross-service data arrives via
-- API, never a join). All columns are nullable: manual receipts and receipts
-- posted before this migration have none, and the register shows "-".
--
-- Idempotent. Rollback: ALTER TABLE inventory.movements DROP COLUMN IF EXISTS
-- grn_no, DROP COLUMN IF EXISTS po_ref, DROP COLUMN IF EXISTS supplier_id;

SET lock_timeout = '5s';

ALTER TABLE inventory.movements ADD COLUMN IF NOT EXISTS grn_no      VARCHAR(64);
ALTER TABLE inventory.movements ADD COLUMN IF NOT EXISTS po_ref      VARCHAR(64);
ALTER TABLE inventory.movements ADD COLUMN IF NOT EXISTS supplier_id UUID;
