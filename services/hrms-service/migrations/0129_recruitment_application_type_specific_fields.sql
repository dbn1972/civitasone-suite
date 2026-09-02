-- 0129_recruitment_application_type_specific_fields.sql
--
-- Root cause: modules/recruitment/schema.ts declares a block of
-- "type-specific fields (populated based on vacancy_type of the job
-- opening)" on hrmsApplications (table recruitment.hrms_applications) --
-- institutionName, graduationYear, semester, tradeCategory, itiCertNo,
-- availabilityHoursPerWeek, stipendExpectedMinor -- but no migration ever
-- added any of these 7 columns. Migration 0012 (vacancy types) added the
-- vacancy_type concept and a few other application columns but stopped
-- short of these. Any `select *` against hrms_applications (e.g.
-- GET /v1/hrms/talent-pool -> repo.searchApplications) 500s with
-- `column "institution_name" does not exist` -- see
-- tests/routes-coverage-a.test.ts "GET /v1/hrms/talent-pool".
--
-- Column list, types, defaults and nullability below are copied 1:1 from
-- the Drizzle declaration in modules/recruitment/schema.ts. All 7 columns
-- are nullable with no default in schema.ts, matching their optional,
-- vacancy-type-conditional nature (e.g. institution_name / graduation_year
-- only apply to internship/apprenticeship applications).
--
-- Additive, idempotent, forward-only. Safe to re-run.

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS institution_name text;

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS graduation_year integer;

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS semester varchar(20);

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS trade_category varchar(100);

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS iti_cert_no varchar(80);

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS availability_hours_per_week integer;

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS stipend_expected_minor bigint;
