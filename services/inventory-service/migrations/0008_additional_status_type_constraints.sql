-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: inventory-service

SET lock_timeout = '5s';

-- ============================================================================
-- inventory.items.item_type
-- Valid values: consumable, fixed_asset, service
-- (source: modules/items/validators.ts itemType enum, enforced at the route
-- boundary on create/update and re-validated at the consume boundary)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE inventory.items
    ADD CONSTRAINT items_item_type_check
    CHECK (item_type IN ('consumable', 'fixed_asset', 'service'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- inventory.movements.movement_type
-- Valid values: receipt, issue, transfer, adjustment
-- (source: modules/movements/domain.ts MovementType — the consumer
-- (movements/consumer.ts) is the only writer and passes a literal from this
-- set as insertHeader's movementType argument for every command handler)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE inventory.movements
    ADD CONSTRAINT movements_movement_type_check
    CHECK (movement_type IN ('receipt', 'issue', 'transfer', 'adjustment'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- inventory.stock_ledger.movement_type
-- Valid values: receipt, issue, transfer, adjustment
-- (source: modules/movements/domain.ts MovementType — every ledger() call in
-- movements/consumer.ts is passed the same movementType literal used for the
-- movements header above)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE inventory.stock_ledger
    ADD CONSTRAINT stock_ledger_movement_type_check
    CHECK (movement_type IN ('receipt', 'issue', 'transfer', 'adjustment'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE inventory.items VALIDATE CONSTRAINT items_item_type_check;
ALTER TABLE inventory.movements VALIDATE CONSTRAINT movements_movement_type_check;
ALTER TABLE inventory.stock_ledger VALIDATE CONSTRAINT stock_ledger_movement_type_check;
