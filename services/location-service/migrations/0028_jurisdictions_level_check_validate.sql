-- 0028_jurisdictions_level_check_validate.sql
--
-- UAT F100: jurisdiction.jurisdictions.jurisdictions_level_check exists on live UAT only as NOT VALID. It was
-- added NOT VALID by 0010_additional_status_type_constraints.sql, whose VALIDATE step failed on existing rows, and the
-- tolerant deploy runner hid the error. Fresh / CI databases have it validated.
--
-- Rows violating it on UAT (SELECT only, 2026-10-31): 4 jurisdictions of the DEV DEMO tenant
--   (00000000-0000-0000-0000-000000000001, the 'Pilot' revenue seed of 2026-07-14):
--   level 'tehsil' x2 (unit PILOT-TEH), level 'subdivision' x2 (unit PILOT-SD).
-- 'tehsil'/'subdivision' are hierarchy UNIT types (hierarchy validators UNIT_TYPES),
-- not jurisdiction levels: jurisdiction/validators.ts JURISDICTION_LEVELS is
-- state|district|block|gp|ward|zone, so the API itself can never write these values.
--
-- This migration:
--   1. Repairs exactly those values: 'tehsil' and 'subdivision' -> 'block', the sub-district
--      jurisdiction level in JURISDICTION_LEVELS (the unit_id keeps the precise unit).
--      Exact predicate on the column value; no other column changes except updated_at.
--   2. Makes the constraint real: it must exist ON jurisdiction.jurisdictions with this name AND
--      definition (a same-named constraint with a different definition raises instead
--      of being trusted by name), is added NOT VALID if missing, then VALIDATEd.
--
-- Rows changed on UAT: 4. Fresh / CI: 0 rows, constraint already validated; no-op.
-- Idempotent: the UPDATE matches nothing on a re-run and VALIDATE is skipped once
-- convalidated.
--
-- RLS: jurisdiction.jurisdictions is FORCE RLS; when the runner applies this as the table owner
-- (NOBYPASSRLS) the UPDATE would see no rows, so FORCE is lifted for the UPDATE and
-- restored in the same transaction (house idiom). Run as the table OWNER or a
-- superuser (on UAT the table is owned by civitas_admin, not location_svc).
--
-- Preview on UAT (SELECT only):
--   SELECT id, level FROM jurisdiction.jurisdictions WHERE level IN ('tehsil', 'subdivision');
--
-- Rollback: ALTER TABLE jurisdiction.jurisdictions DROP CONSTRAINT IF EXISTS jurisdictions_level_check; then re-add it NOT VALID
-- (see 0010_additional_status_type_constraints.sql). The repaired values are not reversed.

SET lock_timeout = '5s';

BEGIN;

DO $$
DECLARE
  forced boolean;
  n      bigint;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'jurisdiction.jurisdictions'::regclass;
  IF forced THEN
    ALTER TABLE jurisdiction.jurisdictions NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE jurisdiction.jurisdictions SET level = 'block', updated_at = now() WHERE level IN ('tehsil', 'subdivision');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0028: level tehsil/subdivision -> block: % row(s)', n;

  IF forced THEN
    ALTER TABLE jurisdiction.jurisdictions FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
DECLARE
  def      text := $d$CHECK (level IN ('state', 'district', 'block', 'gp', 'ward', 'zone'))$d$;
  want     text;
  existing record;
BEGIN
  -- Canonical, cast/paren-insensitive text of the wanted definition (pg_dump round trips
  -- re-deparse the same CHECK with casts in different places) (catalog-only NOT VALID probe, dropped again).
  EXECUTE format('ALTER TABLE jurisdiction.jurisdictions ADD CONSTRAINT %I %s NOT VALID', 'f100_probe_jurisdictions_level_check', def);
  SELECT regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
             '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') INTO want
    FROM pg_constraint WHERE conrelid = 'jurisdiction.jurisdictions'::regclass AND conname = 'f100_probe_jurisdictions_level_check';
  ALTER TABLE jurisdiction.jurisdictions DROP CONSTRAINT f100_probe_jurisdictions_level_check;

  SELECT oid, contype, regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
             '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') AS d INTO existing
    FROM pg_constraint WHERE conrelid = 'jurisdiction.jurisdictions'::regclass AND conname = 'jurisdictions_level_check';

  IF existing.oid IS NULL THEN
    EXECUTE format('ALTER TABLE jurisdiction.jurisdictions ADD CONSTRAINT jurisdictions_level_check %s NOT VALID', def);
    RAISE NOTICE '0028: added jurisdictions_level_check';
  ELSIF existing.contype <> 'c' OR existing.d <> want THEN
    RAISE EXCEPTION '0028: jurisdictions_level_check exists with a different definition: % (wanted %)', existing.d, want;
  END IF;

  IF NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'jurisdiction.jurisdictions'::regclass AND conname = 'jurisdictions_level_check') THEN
    ALTER TABLE jurisdiction.jurisdictions VALIDATE CONSTRAINT jurisdictions_level_check;
    RAISE NOTICE '0028: validated jurisdictions_level_check';
  END IF;
END $$;

COMMIT;
