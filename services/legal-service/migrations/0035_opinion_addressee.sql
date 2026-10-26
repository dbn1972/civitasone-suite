-- Migration: 0035_opinion_addressee
-- Purpose: GAP-LEGAL-OPINIONS-NEW-03 (owner decision #13). An opinion request is addressed to an
--   internal department (id from the org hierarchy, the default) or to an external party (free
--   text). Pre-existing opinions have no addressee and keep NULLs: nothing is back-filled or guessed.
-- Rollback:
--   ALTER TABLE opinions.legal_opinions DROP CONSTRAINT IF EXISTS chk_legal_opinions_addressee;
--   ALTER TABLE opinions.legal_opinions DROP COLUMN IF EXISTS addressee_type,
--     DROP COLUMN IF EXISTS addressee_department_id, DROP COLUMN IF EXISTS addressee_name;
-- Affected services: legal-service

SET lock_timeout = '5s';

ALTER TABLE opinions.legal_opinions
  ADD COLUMN IF NOT EXISTS addressee_type          TEXT,
  ADD COLUMN IF NOT EXISTS addressee_department_id UUID,
  ADD COLUMN IF NOT EXISTS addressee_name          TEXT;

ALTER TABLE opinions.legal_opinions DROP CONSTRAINT IF EXISTS chk_legal_opinions_addressee;
ALTER TABLE opinions.legal_opinions ADD CONSTRAINT chk_legal_opinions_addressee CHECK (
  (addressee_type IS NULL AND addressee_department_id IS NULL AND addressee_name IS NULL)
  OR (addressee_type = 'department' AND addressee_department_id IS NOT NULL AND addressee_name IS NULL)
  OR (addressee_type = 'external' AND addressee_name IS NOT NULL AND length(btrim(addressee_name)) > 0 AND addressee_department_id IS NULL)
) NOT VALID;
-- NOT VALID: existing rows are all-NULL and satisfy it, but we do not rewrite/scan the table under lock.
ALTER TABLE opinions.legal_opinions VALIDATE CONSTRAINT chk_legal_opinions_addressee;
