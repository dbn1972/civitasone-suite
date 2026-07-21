-- Add missing columns to lifecycle.physical_verifications
-- Required by Drizzle schema: version, created_by, updated_by
-- Rollback: ALTER TABLE lifecycle.physical_verifications DROP COLUMN version, DROP COLUMN created_by, DROP COLUMN updated_by;

SET lock_timeout = '5s';

ALTER TABLE lifecycle.physical_verifications
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS updated_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
