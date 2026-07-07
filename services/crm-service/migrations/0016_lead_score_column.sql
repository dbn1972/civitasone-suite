-- Purpose: Add lead score column to contacts table for weighted attribute scoring (0–100)
-- Rollback: ALTER TABLE crm.contacts DROP COLUMN IF EXISTS score;
-- Affected services: crm-service

SET lock_timeout = '5s';

-- Add score column: integer 0–100, nullable (null = not yet scored)
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS score integer;

-- CHECK constraint: score must be within valid range when set
ALTER TABLE crm.contacts ADD CONSTRAINT IF NOT EXISTS chk_contacts_score_range
  CHECK (score IS NULL OR (score >= 0 AND score <= 100));

-- Index for querying leads by score (common for assignment rules and dashboards)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_score
  ON crm.contacts(tenant_id, score DESC)
  WHERE score IS NOT NULL AND status = 'active';
