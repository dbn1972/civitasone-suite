-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: plugin-service

SET lock_timeout = '5s';

-- ============================================================================
-- plugin.items.status
-- Valid states: active, disabled, deprecated
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE plugin.items
    ADD CONSTRAINT items_status_check
    CHECK (status IN ('active', 'disabled', 'deprecated'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- registry.plugins.state
-- Valid states: uploaded, installed, enabled, active, disabled, uninstalled
-- NOTE: registry.plugins is declared in src/modules/registry/schema.ts and
-- referenced by migration 0004's RLS policy, but no migration in this
-- service actually creates the registry schema/table yet (pre-existing gap,
-- out of scope for this migration). Guard on existence so this file stays
-- safely re-runnable both before and after that table is created.
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'registry' AND table_name = 'plugins') THEN
    BEGIN
      ALTER TABLE registry.plugins
        ADD CONSTRAINT plugins_state_check
        CHECK (state IN ('uploaded', 'installed', 'enabled', 'active', 'disabled', 'uninstalled'))
        NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE plugin.items VALIDATE CONSTRAINT items_status_check;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'registry' AND table_name = 'plugins') THEN
    ALTER TABLE registry.plugins VALIDATE CONSTRAINT plugins_state_check;
  END IF;
END $$;
