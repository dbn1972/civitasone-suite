-- Migration 0013: Add missing columns for applicationWithdraw and applicationAssignReviewer consumers
-- Rollback: ALTER TABLE application.grant_applications DROP COLUMN IF EXISTS withdrawn_at, DROP COLUMN IF EXISTS reviewer_ref, DROP COLUMN IF EXISTS assigned_at;

SET lock_timeout = '5s';

ALTER TABLE application.grant_applications
  ADD COLUMN IF NOT EXISTS withdrawn_at  TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS reviewer_ref  TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at   TIMESTAMP WITH TIME ZONE;
