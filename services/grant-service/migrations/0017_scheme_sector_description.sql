-- Migration 0017: GAP-GRANTS-SCHEMES-NEW-03 (UAT B4) -- persist a scheme's sector and
-- free-text description so the create form's two fields are stored, returned by
-- GET /v1/grants/schemes/:id and shown on the scheme detail page.
--
-- Additive, nullable and idempotent. Safe to re-run.
-- Rollback:
--   ALTER TABLE scheme.grant_schemes DROP CONSTRAINT IF EXISTS chk_grant_schemes_sector;
--   ALTER TABLE scheme.grant_schemes DROP COLUMN IF EXISTS sector, DROP COLUMN IF EXISTS description;
-- Run as: grant_svc on civitas_grant
-- Affected services: grant-service (scheme module)

SET lock_timeout = '5s';

ALTER TABLE scheme.grant_schemes
  ADD COLUMN IF NOT EXISTS sector      varchar(32),
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE scheme.grant_schemes DROP CONSTRAINT IF EXISTS chk_grant_schemes_sector;
ALTER TABLE scheme.grant_schemes ADD CONSTRAINT chk_grant_schemes_sector
  CHECK (sector IS NULL OR sector IN (
    'agriculture', 'education', 'health', 'rural_development', 'urban_development',
    'social_welfare', 'skill_development', 'culture_sports', 'other'
  ));
