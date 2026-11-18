-- 0173_finance_settings_commercial_gst.sql
-- MSME commercial segment, slice M0 (docs/design/MSME-COMMERCIAL.md section 10, 11 row M0). Additive and idempotent.
--  gl.finance_settings gains the commercial / GST identity of a tenant:
--    gst_registered  boolean NOT NULL DEFAULT false   -- constant default: metadata-only on PG 11+, no table rewrite
--    gstin           varchar(15) NULL
--    gst_effective_from date NULL
--    entity_type     text NULL, one of company | llp | partnership | proprietorship (text + CHECK, not a PG enum, so a later
--                    entity type is a constraint swap rather than ALTER TYPE)
--  CHECK finance_settings_gstin_when_registered: gst_registered => gstin NOT NULL and matches the GSTIN pattern.
--  CHECK finance_settings_entity_type_valid.
-- Backfill rule: every existing row reads gst_registered = false, gstin / gst_effective_from / entity_type NULL (the defaults ARE
--  the backfill), so both CHECKs hold for every existing row; govt behaviour is unchanged. Nothing reads these columns yet.
-- Constraints are added NOT VALID then VALIDATEd (the validating scan takes only SHARE UPDATE EXCLUSIVE) under lock_timeout.
-- Changed only through the maker-checker route (approvals/), like accounting_basis. coa_template / profile_code stay non-API-settable.
-- Rollback: ALTER TABLE gl.finance_settings DROP CONSTRAINT IF EXISTS finance_settings_gstin_when_registered,
--             DROP CONSTRAINT IF EXISTS finance_settings_entity_type_valid, DROP COLUMN IF EXISTS gst_registered,
--             DROP COLUMN IF EXISTS gstin, DROP COLUMN IF EXISTS gst_effective_from, DROP COLUMN IF EXISTS entity_type;
--           (only while no tenant has gst_registered = true and relies on it).

SET lock_timeout = '5s';

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS gst_registered boolean NOT NULL DEFAULT false;
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS gstin varchar(15);
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS gst_effective_from date;
ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS entity_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_settings_gstin_when_registered' AND conrelid = 'gl.finance_settings'::regclass) THEN
    ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_gstin_when_registered
      CHECK (NOT gst_registered OR (gstin IS NOT NULL AND gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_settings_entity_type_valid' AND conrelid = 'gl.finance_settings'::regclass) THEN
    ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_entity_type_valid
      CHECK (entity_type IS NULL OR entity_type IN ('company', 'llp', 'partnership', 'proprietorship')) NOT VALID;
  END IF;
END $$;

ALTER TABLE gl.finance_settings VALIDATE CONSTRAINT finance_settings_gstin_when_registered;
ALTER TABLE gl.finance_settings VALIDATE CONSTRAINT finance_settings_entity_type_valid;
