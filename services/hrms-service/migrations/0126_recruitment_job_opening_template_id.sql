-- Migration 0126: add recruitment.hrms_job_openings.template_id
--
-- Root cause: recruitment/schema.ts declared `templateId: uuid("template_id")`
-- on hrmsJobOpenings (no .references() in the Drizzle schema, so no FK here
-- either) but no migration ever added the column. Every Drizzle
-- select()/insert() over hrms_job_openings fails with
-- `column "template_id" of relation "hrms_job_openings" does not exist`
-- (42703) on a cluster bootstrapped from the current migrations.
--
-- Idempotent: safe to re-run.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS template_id uuid;

COMMIT;
