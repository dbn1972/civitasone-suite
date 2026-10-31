-- 0021_jobs_status_check_validate.sql
--
-- UAT F100: reports.jobs.jobs_status_check exists on live UAT only as NOT VALID. It was
-- added NOT VALID by 0008_check_constraints_status_columns.sql, whose VALIDATE step failed on existing rows, and the
-- tolerant deploy runner hid the error. Fresh / CI databases have it validated.
--
-- Rows violating it on UAT (SELECT only, 2026-10-31): 3 seed jobs of the DEV DEMO tenant, created 2026-06-20,
--   never run (no completed_at): 33333333-3000-0000-0000-000000000002 'pending',
--   33333333-0003-0000-0000-000000000001 and 33333333-0003-0000-0000-000000000002 'active'.
-- Neither value is a job status (queued|processing|completed|failed); the jobs
-- routes already present any unknown status as 'queued'.
--
-- This migration:
--   1. Repairs exactly those values: 'pending' and 'active' -> 'queued', which is exactly how the
--      API shows them today. No worker polls status = 'queued' (render is event-driven),
--      so this does not start any job.
--      Exact predicate on the column value; no other column changes except updated_at.
--   2. Makes the constraint real: it must exist ON reports.jobs with this name AND
--      definition (a same-named constraint with a different definition raises instead
--      of being trusted by name), is added NOT VALID if missing, then VALIDATEd.
--
-- Rows changed on UAT: 3. Fresh / CI: 0 rows, constraint already validated; no-op.
-- Idempotent: the UPDATE matches nothing on a re-run and VALIDATE is skipped once
-- convalidated.
--
-- RLS: reports.jobs is FORCE RLS; when the runner applies this as the table owner
-- (NOBYPASSRLS) the UPDATE would see no rows, so FORCE is lifted for the UPDATE and
-- restored in the same transaction (house idiom). Run as the table OWNER or a
-- superuser.
--
-- Preview on UAT (SELECT only):
--   SELECT id, status FROM reports.jobs WHERE status IN ('pending', 'active');
--
-- Rollback: ALTER TABLE reports.jobs DROP CONSTRAINT IF EXISTS jobs_status_check; then re-add it NOT VALID
-- (see 0008_check_constraints_status_columns.sql). The repaired values are not reversed.

SET lock_timeout = '5s';

BEGIN;

DO $$
DECLARE
  forced boolean;
  n      bigint;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'reports.jobs'::regclass;
  IF forced THEN
    ALTER TABLE reports.jobs NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE reports.jobs SET status = 'queued', updated_at = now() WHERE status IN ('pending', 'active');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0021: status pending/active -> queued: % row(s)', n;

  IF forced THEN
    ALTER TABLE reports.jobs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
DECLARE
  def      text := $d$CHECK (status IN ('queued', 'processing', 'completed', 'failed'))$d$;
  want     text;
  existing record;
BEGIN
  -- Canonical, cast/paren-insensitive text of the wanted definition (pg_dump round trips
  -- re-deparse the same CHECK with casts in different places) (catalog-only NOT VALID probe, dropped again).
  EXECUTE format('ALTER TABLE reports.jobs ADD CONSTRAINT %I %s NOT VALID', 'f100_probe_jobs_status_check', def);
  SELECT regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
             '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') INTO want
    FROM pg_constraint WHERE conrelid = 'reports.jobs'::regclass AND conname = 'f100_probe_jobs_status_check';
  ALTER TABLE reports.jobs DROP CONSTRAINT f100_probe_jobs_status_check;

  SELECT oid, contype, regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
             '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') AS d INTO existing
    FROM pg_constraint WHERE conrelid = 'reports.jobs'::regclass AND conname = 'jobs_status_check';

  IF existing.oid IS NULL THEN
    EXECUTE format('ALTER TABLE reports.jobs ADD CONSTRAINT jobs_status_check %s NOT VALID', def);
    RAISE NOTICE '0021: added jobs_status_check';
  ELSIF existing.contype <> 'c' OR existing.d <> want THEN
    RAISE EXCEPTION '0021: jobs_status_check exists with a different definition: % (wanted %)', existing.d, want;
  END IF;

  IF NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'reports.jobs'::regclass AND conname = 'jobs_status_check') THEN
    ALTER TABLE reports.jobs VALIDATE CONSTRAINT jobs_status_check;
    RAISE NOTICE '0021: validated jobs_status_check';
  END IF;
END $$;

COMMIT;
