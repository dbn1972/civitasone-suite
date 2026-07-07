-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: inventory-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- inventory.categories.parent_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_parent_id
  ON inventory.categories (parent_id);

-- inventory.items.category_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_category_id
  ON inventory.items (category_id);

-- inventory.items.uom_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_uom_id
  ON inventory.items (uom_id);

-- inventory.movements.from_store_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movements_from_store_id
  ON inventory.movements (from_store_id);

-- inventory.movements.to_store_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movements_to_store_id
  ON inventory.movements (to_store_id);

-- inventory.movement_lines.item_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movement_lines_item_id
  ON inventory.movement_lines (item_id);

-- inventory.stock_balances.item_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_balances_item_id
  ON inventory.stock_balances (item_id);

-- inventory.stock_balances.store_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_balances_store_id
  ON inventory.stock_balances (store_id);

-- inventory.stock_ledger.item_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_ledger_item_id
  ON inventory.stock_ledger (item_id);

-- inventory.stock_ledger.store_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_ledger_store_id
  ON inventory.stock_ledger (store_id);
