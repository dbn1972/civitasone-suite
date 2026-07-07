-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: workflow-service

SET lock_timeout = '5s';

-- ============================================================================
-- workflow.instances.status
-- Valid states: active, completed, suspended, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.instances
    ADD CONSTRAINT instances_status_check
    CHECK (status IN ('active', 'completed', 'suspended', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- workflow.tasks.status
-- Valid states: pending, completed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.tasks
    ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('pending', 'completed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- workflow.definitions.status
-- Valid states: active, draft, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.definitions
    ADD CONSTRAINT definitions_status_check
    CHECK (status IN ('active', 'draft', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- workflow.decision_tables.status
-- Valid states: draft, active, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.decision_tables
    ADD CONSTRAINT decision_tables_status_check
    CHECK (status IN ('draft', 'active', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- workflow.message_subscriptions.status
-- Valid states: active, matched, expired
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.message_subscriptions
    ADD CONSTRAINT message_subscriptions_status_check
    CHECK (status IN ('active', 'matched', 'expired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- workflow.signal_subscriptions.status
-- Valid states: active, matched, expired
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.signal_subscriptions
    ADD CONSTRAINT signal_subscriptions_status_check
    CHECK (status IN ('active', 'matched', 'expired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE workflow.instances VALIDATE CONSTRAINT instances_status_check;
ALTER TABLE workflow.tasks VALIDATE CONSTRAINT tasks_status_check;
ALTER TABLE workflow.definitions VALIDATE CONSTRAINT definitions_status_check;
ALTER TABLE workflow.decision_tables VALIDATE CONSTRAINT decision_tables_status_check;
ALTER TABLE workflow.message_subscriptions VALIDATE CONSTRAINT message_subscriptions_status_check;
ALTER TABLE workflow.signal_subscriptions VALIDATE CONSTRAINT signal_subscriptions_status_check;
