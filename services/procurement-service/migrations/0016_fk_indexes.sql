-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: procurement-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- indent.procurement_indent_items.indent_id → indent.procurement_indents
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_indent_items_indent_id
  ON indent.procurement_indent_items (indent_id);

-- vendor.procurement_vendor_docs.vendor_id → vendor.procurement_vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_docs_vendor_id
  ON vendor.procurement_vendor_docs (vendor_id);

-- vendor.procurement_empanelment.vendor_id → vendor.procurement_vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_empanelment_vendor_id
  ON vendor.procurement_empanelment (vendor_id);

-- po.procurement_po_items.po_id → po.procurement_pos
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_po_items_po_id
  ON po.procurement_po_items (po_id);

-- grn.procurement_grn_items.grn_id → grn.procurement_grns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grn_items_grn_id
  ON grn.procurement_grn_items (grn_id);

-- grn.procurement_inspections.grn_id → grn.procurement_grns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspections_grn_id
  ON grn.procurement_inspections (grn_id);

-- grn.procurement_inspections.inspector_id (FK to user)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspections_inspector_id
  ON grn.procurement_inspections (inspector_id);

-- auction.procurement_bids.vendor_id → vendor.procurement_vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bids_vendor_id
  ON auction.procurement_bids (vendor_id);

-- payments.procurement_advances.vendor_id → vendor.procurement_vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_advances_vendor_id
  ON payments.procurement_advances (vendor_id);

-- payments.procurement_debit_notes.vendor_id → vendor.procurement_vendors
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_debit_notes_vendor_id
  ON payments.procurement_debit_notes (vendor_id);
