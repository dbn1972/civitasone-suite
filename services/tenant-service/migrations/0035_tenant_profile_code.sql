-- 0035_tenant_profile_code.sql
-- Tenant-type profile switch (docs/design/TENANT-PROFILE-SWITCH.md), slice S1.
-- Adds tenant.tenants.profile_code, the tenant's profile inside its edition (govt -> govt_dept | govt_small_office, ...).
-- The profile DEFINITIONS are code (packages/tenant-profile); this column is only the assignment.
--
-- Backfill rule (no behaviour change): profile_code = govt_dept for edition govt, otherwise the edition name. Those
-- profiles carry the legacy settings, so every existing tenant behaves as before.
-- A BEFORE INSERT trigger fills the same default when an older binary inserts a row without profile_code, so a rolling
-- deploy never fails an insert. The format check keeps the column well-formed; which codes are valid is decided in code.
--
-- RLS: tenant.tenants is FORCE RLS; FORCE is lifted for the backfill UPDATE and restored in the same transaction
-- (house idiom of 0034). Run as the table OWNER or a superuser.
-- Rollback: DROP TRIGGER tenants_profile_code_default ON tenant.tenants; DROP FUNCTION tenant.tenants_profile_code_default();
-- ALTER TABLE tenant.tenants DROP COLUMN profile_code;

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS profile_code varchar(32);

DO $$
DECLARE
  forced boolean;
  n      bigint;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'tenant.tenants'::regclass;
  IF forced THEN
    ALTER TABLE tenant.tenants NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE tenant.tenants
     SET profile_code = CASE edition WHEN 'govt' THEN 'govt_dept' ELSE edition END
   WHERE profile_code IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0035: profile_code backfilled on % row(s)', n;

  IF forced THEN
    ALTER TABLE tenant.tenants FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION tenant.tenants_profile_code_default() RETURNS trigger AS $f$
BEGIN
  IF NEW.profile_code IS NULL THEN
    NEW.profile_code := CASE NEW.edition WHEN 'govt' THEN 'govt_dept' ELSE NEW.edition END;
  END IF;
  RETURN NEW;
END
$f$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_profile_code_default ON tenant.tenants;
CREATE TRIGGER tenants_profile_code_default BEFORE INSERT ON tenant.tenants
  FOR EACH ROW EXECUTE FUNCTION tenant.tenants_profile_code_default();

ALTER TABLE tenant.tenants ALTER COLUMN profile_code SET NOT NULL;
ALTER TABLE tenant.tenants DROP CONSTRAINT IF EXISTS tenants_profile_code_check;
ALTER TABLE tenant.tenants ADD CONSTRAINT tenants_profile_code_check CHECK (profile_code ~ '^[a-z][a-z0-9_]{1,31}$');

COMMIT;
