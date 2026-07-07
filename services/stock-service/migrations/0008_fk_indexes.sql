-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: stock-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- entry.stock_entries.from_warehouse_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_entries_from_warehouse_id
  ON entry.stock_entries (from_warehouse_id);

-- entry.stock_entries.to_warehouse_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_entries_to_warehouse_id
  ON entry.stock_entries (to_warehouse_id);

-- entry.stock_entry_items.item_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_entry_items_item_id
  ON entry.stock_entry_items (item_id);

-- item.stock_items.category_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_items_category_id
  ON item.stock_items (category_id);

-- item.stock_items.uom_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_items_uom_id
  ON item.stock_items (uom_id);

-- ledger.stock_ledger.item_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_ledger_item_id
  ON ledger.stock_ledger (item_id);

-- ledger.stock_ledger.warehouse_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_ledger_warehouse_id
  ON ledger.stock_ledger (warehouse_id);

-- entry.stock_receipts.item_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_receipts_item_id
  ON entry.stock_receipts (item_id);

-- entry.stock_receipts.warehouse_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_receipts_warehouse_id
  ON entry.stock_receipts (warehouse_id);

-- entry.stock_receipts.entry_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_receipts_entry_id
  ON entry.stock_receipts (entry_id);

-- valuation.stock_valuation_rates.item_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_valuation_rates_item_id
  ON valuation.stock_valuation_rates (item_id);

-- valuation.stock_valuation_rates.warehouse_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_valuation_rates_warehouse_id
  ON valuation.stock_valuation_rates (warehouse_id);

-- warehouse.stock_locations.warehouse_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_locations_warehouse_id
  ON warehouse.stock_locations (warehouse_id);
