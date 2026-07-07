-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: inventory-service

SET lock_timeout = '5s';

-- ============================================================================
-- inventory.items.status
-- Valid states: active, inactive, discontinued, blocked
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE inventory.items
    ADD CONSTRAINT items_status_check
    CHECK (status IN ('active', 'inactive', 'discontinued', 'blocked'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- inventory.movements.status
-- Valid states: posted, reversed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE inventory.movements
    ADD CONSTRAINT movements_status_check
    CHECK (status IN ('posted', 'reversed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE inventory.items VALIDATE CONSTRAINT items_status_check;
ALTER TABLE inventory.movements VALIDATE CONSTRAINT movements_status_check;
