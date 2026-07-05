-- Purpose: Add version, updated_by, updated_at columns to crm.activities for optimistic locking.
-- Rollback: ALTER TABLE crm.activities DROP COLUMN IF EXISTS version;
--           ALTER TABLE crm.activities DROP COLUMN IF EXISTS updated_by;
--           ALTER TABLE crm.activities DROP COLUMN IF EXISTS updated_at;
-- Affected services: crm-service

SET lock_timeout = '5s';

ALTER TABLE crm.activities ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE crm.activities ADD COLUMN IF NOT EXISTS updated_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE crm.activities ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
