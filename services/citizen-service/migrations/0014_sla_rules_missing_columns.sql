-- Add missing columns to citizen.sla_rules
-- Required by Drizzle schema: version, created_by, updated_by, updated_at
-- Rollback: ALTER TABLE citizen.sla_rules DROP COLUMN version, DROP COLUMN created_by, DROP COLUMN updated_by, DROP COLUMN updated_at;

SET lock_timeout = '5s';

ALTER TABLE citizen.sla_rules
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS updated_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
