-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: install-service

SET lock_timeout = '5s';

-- ============================================================================
-- install.stages.status
-- Valid states: active, completed, skipped
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE install.stages
    ADD CONSTRAINT stages_status_check
    CHECK (status IN ('active', 'completed', 'skipped'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- orchestrator.wizard_definitions.status
-- Valid states: active, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE orchestrator.wizard_definitions
    ADD CONSTRAINT wizard_definitions_status_check
    CHECK (status IN ('active', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- orchestrator.step_executions.status
-- Valid states: pending, blocked, ready, in_progress, completed, failed, skipped
-- (domain.ts StepExec.status; consumer.ts writes in_progress/completed/skipped/ready)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE orchestrator.step_executions
    ADD CONSTRAINT step_executions_status_check
    CHECK (status IN ('pending', 'blocked', 'ready', 'in_progress', 'completed', 'failed', 'skipped'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- install.silo_provisions.status
-- Valid states: requested, provisioning, ready, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE install.silo_provisions
    ADD CONSTRAINT silo_provisions_status_check
    CHECK (status IN ('requested', 'provisioning', 'ready', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE install.stages VALIDATE CONSTRAINT stages_status_check;
ALTER TABLE orchestrator.wizard_definitions VALIDATE CONSTRAINT wizard_definitions_status_check;
ALTER TABLE orchestrator.step_executions VALIDATE CONSTRAINT step_executions_status_check;
ALTER TABLE install.silo_provisions VALIDATE CONSTRAINT silo_provisions_status_check;
