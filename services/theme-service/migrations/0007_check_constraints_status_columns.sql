-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: theme-service

SET lock_timeout = '5s';

-- ============================================================================
-- theme.tokens.status
-- Valid states: active, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE theme.tokens
    ADD CONSTRAINT tokens_status_check
    CHECK (status IN ('active', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- templates.templates.type
-- Valid values: email, letter, certificate (validators.ts templateTypeEnum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE templates.templates
    ADD CONSTRAINT templates_type_check
    CHECK (type IN ('email', 'letter', 'certificate'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE theme.tokens VALIDATE CONSTRAINT tokens_status_check;
ALTER TABLE templates.templates VALIDATE CONSTRAINT templates_type_check;
