-- 0034_tenants_edition_check_validate.sql
--
-- UAT F100: tenant.tenants.tenants_edition_check exists on live UAT only as NOT VALID. It was
-- added NOT VALID by 0014_additional_status_type_constraints.sql, whose VALIDATE step failed on existing rows, and the
-- tolerant deploy runner hid the error. Fresh / CI databases have it validated.
--
-- Rows violating it on UAT (SELECT only, 2026-10-31): 1 tenant, ac6674ae-c42f-4a5b-2d76-26dfee354e5c
--   'P11 Idem Test' (status draft, created 2026-06-24), edition 'govt_dept'.
-- 'govt_dept' is a PLAN edition (plans/validators.ts editionValues); the tenant
-- edition vocabulary (tenant/validators.ts) is govt|psu|private|ngo|section8|cooperative|small_office.
--
-- This migration:
--   1. Repairs exactly those values: 'govt_dept' -> 'govt'.
--      Exact predicate on the column value; no other column changes except updated_at.
--   2. Makes the constraint real: it must exist ON tenant.tenants with this name AND
--      definition (a same-named constraint with a different definition raises instead
--      of being trusted by name), is added NOT VALID if missing, then VALIDATEd.
--
-- Rows changed on UAT: 1. Fresh / CI: 0 rows, constraint already validated; no-op.
-- Idempotent: the UPDATE matches nothing on a re-run and VALIDATE is skipped once
-- convalidated.
--
-- RLS: tenant.tenants is FORCE RLS; when the runner applies this as the table owner
-- (NOBYPASSRLS) the UPDATE would see no rows, so FORCE is lifted for the UPDATE and
-- restored in the same transaction (house idiom). Run as the table OWNER or a
-- superuser.
--
-- Preview on UAT (SELECT only):
--   SELECT id, edition FROM tenant.tenants WHERE edition IN ('govt_dept');
--
-- Rollback: ALTER TABLE tenant.tenants DROP CONSTRAINT IF EXISTS tenants_edition_check; then re-add it NOT VALID
-- (see 0014_additional_status_type_constraints.sql). The repaired values are not reversed.

SET lock_timeout = '5s';

BEGIN;

DO $$
DECLARE
  forced boolean;
  n      bigint;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'tenant.tenants'::regclass;
  IF forced THEN
    ALTER TABLE tenant.tenants NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE tenant.tenants SET edition = 'govt', updated_at = now() WHERE edition IN ('govt_dept');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0034: edition govt_dept -> govt: % row(s)', n;

  IF forced THEN
    ALTER TABLE tenant.tenants FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
DECLARE
  def      text := $d$CHECK (edition IN ('govt', 'psu', 'private', 'ngo', 'section8', 'cooperative', 'small_office'))$d$;
  want     text;
  existing record;
BEGIN
  -- Canonical, cast/paren-insensitive text of the wanted definition (pg_dump round trips
  -- re-deparse the same CHECK with casts in different places) (catalog-only NOT VALID probe, dropped again).
  EXECUTE format('ALTER TABLE tenant.tenants ADD CONSTRAINT %I %s NOT VALID', 'f100_probe_tenants_edition_check', def);
  SELECT regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
             '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') INTO want
    FROM pg_constraint WHERE conrelid = 'tenant.tenants'::regclass AND conname = 'f100_probe_tenants_edition_check';
  ALTER TABLE tenant.tenants DROP CONSTRAINT f100_probe_tenants_edition_check;

  SELECT oid, contype, regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
             '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') AS d INTO existing
    FROM pg_constraint WHERE conrelid = 'tenant.tenants'::regclass AND conname = 'tenants_edition_check';

  IF existing.oid IS NULL THEN
    EXECUTE format('ALTER TABLE tenant.tenants ADD CONSTRAINT tenants_edition_check %s NOT VALID', def);
    RAISE NOTICE '0034: added tenants_edition_check';
  ELSIF existing.contype <> 'c' OR existing.d <> want THEN
    RAISE EXCEPTION '0034: tenants_edition_check exists with a different definition: % (wanted %)', existing.d, want;
  END IF;

  IF NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'tenant.tenants'::regclass AND conname = 'tenants_edition_check') THEN
    ALTER TABLE tenant.tenants VALIDATE CONSTRAINT tenants_edition_check;
    RAISE NOTICE '0034: validated tenants_edition_check';
  END IF;
END $$;

COMMIT;
