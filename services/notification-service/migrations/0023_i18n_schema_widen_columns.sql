-- Purpose: Widen i18n.locale_variants columns to match Drizzle schema (BCP 47 locale support, text subject, status rename)
-- Rollback: ALTER TABLE i18n.locale_variants ALTER COLUMN locale TYPE varchar(10);
--           ALTER TABLE i18n.locale_variants ALTER COLUMN subject TYPE varchar(256);
--           ALTER TABLE i18n.locale_variants ALTER COLUMN status SET DEFAULT 'active';
--           ALTER TABLE i18n.locale_variants DROP CONSTRAINT IF EXISTS chk_locale_status;
--           ALTER TABLE i18n.locale_variants ADD CONSTRAINT chk_locale_status CHECK (status IN ('active', 'needs_review'));
-- Affected services: notification-service (i18n module)
SET lock_timeout = '5s';

-- Widen locale from varchar(10) to varchar(35) to support full BCP 47 codes (e.g. zh-Hans-CN-x-private)
ALTER TABLE i18n.locale_variants
  ALTER COLUMN locale TYPE varchar(35);

-- Widen subject from varchar(256) to text (no length limit for template subjects)
ALTER TABLE i18n.locale_variants
  ALTER COLUMN subject TYPE text;

-- Update status default from 'active' to 'current' to align with Drizzle schema
ALTER TABLE i18n.locale_variants
  ALTER COLUMN status SET DEFAULT 'current';

-- Update CHECK constraint to include new status value
ALTER TABLE i18n.locale_variants
  DROP CONSTRAINT IF EXISTS chk_locale_status;

ALTER TABLE i18n.locale_variants
  ADD CONSTRAINT chk_locale_status CHECK (status IN ('current', 'needs_review'));

-- Backfill existing rows from 'active' to 'current'
UPDATE i18n.locale_variants SET status = 'current' WHERE status = 'active';
