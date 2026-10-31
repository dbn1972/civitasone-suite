-- 0028_jurisdictions_level_check_validate.sql
--
-- UAT F100: jurisdiction.jurisdictions.jurisdictions_level_check exists on live UAT only
-- as NOT VALID. 0010_additional_status_type_constraints.sql added it NOT VALID with
-- state|district|block|gp|ward|zone; its VALIDATE failed and the tolerant deploy runner
-- hid the error.
--
-- The 4 rows that block it (SELECT only, 2026-10-31) are NOT bad data: DEV DEMO tenant
-- 00000000-0000-0000-0000-000000000001, hierarchy_domain 'revenue', level 'tehsil' x2
-- (unit PILOT-TEH) and 'subdivision' x2 (unit PILOT-SD), written by
-- scripts/seed/pilot-district-organogram.sql, which sets level = the unit's type.
-- Tehsil and sub-division are real revenue-hierarchy levels (hierarchy UNIT_TYPES lists
-- both); 'block' belongs to the rural-development hierarchy, so remapping would mislabel
-- real geography. The CHECK was too narrow.
--
-- This migration:
--   1. Replaces the CHECK with one that also allows 'subdivision' and 'tehsil'
--      (jurisdiction/validators.ts JURISDICTION_LEVELS is widened to match). It is only
--      replaced when the existing definition is exactly 0010's (or it is missing); any
--      other same-named definition raises instead of being trusted or overwritten.
--   2. VALIDATEs it.
-- No data changes.
--
-- Rows changed on UAT: 0 (the 4 rows become valid). Fresh / CI: the 0010 constraint is
-- replaced by the wider one and validated (0 rows).
-- Idempotent: once the definition matches it only VALIDATEs if still NOT VALID.
-- Run as the table OWNER (on UAT jurisdiction.jurisdictions is owned by civitas_admin).
--
-- Rollback: re-create 0010's narrower CHECK NOT VALID (the pilot seed rows would then
-- violate it again).

SET lock_timeout = '5s';

BEGIN;

DO $$
DECLARE
  wanted_def text := $d$CHECK (level IN ('state', 'district', 'subdivision', 'tehsil', 'block', 'gp', 'ward', 'zone'))$d$;
  old_def    text := $d$CHECK (level IN ('state', 'district', 'block', 'gp', 'ward', 'zone'))$d$;
  want       text;
  old        text;
  existing   record;
  need_add   boolean;
BEGIN
  -- Canonical, cast/paren-insensitive text of each definition (catalog-only NOT VALID
  -- probes, dropped again; pg_dump round trips re-deparse the same CHECK differently).
  EXECUTE format('ALTER TABLE jurisdiction.jurisdictions ADD CONSTRAINT f100_probe_want %s NOT VALID', wanted_def);
  EXECUTE format('ALTER TABLE jurisdiction.jurisdictions ADD CONSTRAINT f100_probe_old %s NOT VALID', old_def);
  SELECT max(d) FILTER (WHERE conname = 'f100_probe_want'), max(d) FILTER (WHERE conname = 'f100_probe_old')
    INTO want, old
    FROM (SELECT conname,
                 regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
                   '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') AS d
            FROM pg_constraint
           WHERE conrelid = 'jurisdiction.jurisdictions'::regclass
             AND conname IN ('f100_probe_want', 'f100_probe_old')) p;
  ALTER TABLE jurisdiction.jurisdictions DROP CONSTRAINT f100_probe_want;
  ALTER TABLE jurisdiction.jurisdictions DROP CONSTRAINT f100_probe_old;

  SELECT oid, contype,
         regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
           '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') AS d
    INTO existing
    FROM pg_constraint
   WHERE conrelid = 'jurisdiction.jurisdictions'::regclass AND conname = 'jurisdictions_level_check';

  need_add := existing.oid IS NULL;
  IF existing.oid IS NOT NULL AND existing.contype = 'c' AND existing.d = old THEN
    ALTER TABLE jurisdiction.jurisdictions DROP CONSTRAINT jurisdictions_level_check;
    RAISE NOTICE '0028: dropped the 0010 jurisdictions_level_check (no subdivision/tehsil)';
    need_add := true;
  ELSIF existing.oid IS NOT NULL AND (existing.contype <> 'c' OR existing.d <> want) THEN
    RAISE EXCEPTION '0028: jurisdictions_level_check exists with a different definition: % (wanted %)',
      existing.d, want;
  END IF;

  IF need_add THEN
    EXECUTE format('ALTER TABLE jurisdiction.jurisdictions ADD CONSTRAINT jurisdictions_level_check %s NOT VALID', wanted_def);
    RAISE NOTICE '0028: added jurisdictions_level_check with subdivision/tehsil';
  END IF;

  IF NOT (SELECT convalidated FROM pg_constraint
           WHERE conrelid = 'jurisdiction.jurisdictions'::regclass AND conname = 'jurisdictions_level_check') THEN
    ALTER TABLE jurisdiction.jurisdictions VALIDATE CONSTRAINT jurisdictions_level_check;
    RAISE NOTICE '0028: validated jurisdictions_level_check';
  END IF;
END $$;

COMMIT;
