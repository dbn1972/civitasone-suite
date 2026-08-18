-- Purpose: Add lead score column to contacts table for weighted attribute scoring (0–100)
-- Rollback: ALTER TABLE crm.contacts DROP COLUMN IF EXISTS score;
-- Affected services: crm-service

SET lock_timeout = '5s';

-- Add score column: integer 0–100, nullable (null = not yet scored)
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS score integer;

-- CHECK constraint: score must be within valid range when set
--
-- FIXED 2026-07-27: this was `ADD CONSTRAINT IF NOT EXISTS`, which is not valid
-- PostgreSQL — there is no IF NOT EXISTS clause on ADD CONSTRAINT. The statement
-- was a syntax error, so with ON_ERROR_STOP=1 this migration aborted here on
-- every run and the index below was never created either. Detected by running the
-- bootstrap against a throwaway postgres:16-alpine container; it was hidden
-- because scripts/ci/bootstrap-postgres.sh warned and continued.
-- Rewritten to the idempotent DO/duplicate_object form used elsewhere in the repo.
DO $$ BEGIN
  ALTER TABLE crm.contacts ADD CONSTRAINT chk_contacts_score_range
    CHECK (score IS NULL OR (score >= 0 AND score <= 100));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for querying leads by score (common for assignment rules and dashboards)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_score
  ON crm.contacts(tenant_id, score DESC)
  WHERE score IS NOT NULL AND status = 'active';
