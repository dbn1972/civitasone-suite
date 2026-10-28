-- Purpose: persist the optional free-text `notes` (max 500) that POST /v1/crm/accounts/:id/sponsors
--   already accepts and validates. The column never existed, so the note was silently dropped
--   (UAT DB test g2-crm-citizen defect: data loss).
-- Rollback: ALTER TABLE crm.account_relationships DROP COLUMN IF EXISTS notes;
-- Affected services: crm-service (accounts/sponsors-routes.ts)
-- Sequencing: additive and nullable. Existing rows keep notes = NULL; old code ignores the column.

SET lock_timeout = '5s';

ALTER TABLE crm.account_relationships ADD COLUMN IF NOT EXISTS notes varchar(500);
