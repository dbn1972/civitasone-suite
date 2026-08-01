-- Purpose: Add parent_id column to accounts for parent-child org hierarchy (CM-002).
-- Rollback: ALTER TABLE crm.accounts DROP COLUMN IF EXISTS parent_id;
-- Affected services: crm-service

SET lock_timeout = '5s';

ALTER TABLE crm.accounts ADD COLUMN IF NOT EXISTS parent_id uuid;

-- Self-referencing FK for hierarchy. Nullable = root account.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_parent_id_fkey'
  ) THEN
    ALTER TABLE crm.accounts
      ADD CONSTRAINT accounts_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES crm.accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_parent_id ON crm.accounts(parent_id);
