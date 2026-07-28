-- 0074_application_eligibility.sql
-- Application & eligibility (checklist R-RA-0093/0094/0095/0098/0100/0102):
--   • job_openings.eligibility — the advertised eligibility criteria (age
--     min/max as-on cut-off + category-wise relaxation, min experience, permitted
--     qualifications, allow-multiple).
--   • hrms_applications gains: application_no (unique acknowledgement number),
--     date_of_birth + category (to evaluate age with relaxation), the persisted
--     eligibility_result, and a withdraw_reason.
-- Additive + idempotent.
--
-- Rollback: ALTER TABLE recruitment.hrms_job_openings DROP COLUMN IF EXISTS eligibility;
--           ALTER TABLE recruitment.hrms_applications DROP COLUMN IF EXISTS application_no, ...;

ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS eligibility jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS application_no    varchar(48),
  ADD COLUMN IF NOT EXISTS date_of_birth     date,
  ADD COLUMN IF NOT EXISTS category          varchar(16),
  ADD COLUMN IF NOT EXISTS eligibility_result jsonb,
  ADD COLUMN IF NOT EXISTS withdraw_reason   text,
  -- Duplicate-prevention key: lower(email) when the vacancy does NOT allow
  -- multiple applications, else NULL (so multiples-allowed vacancies are exempt).
  -- Populated by the eligibility apply path.
  ADD COLUMN IF NOT EXISTS dedup_key         varchar(320);

-- Unique acknowledgement number per tenant (only where set — legacy rows are null).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_applications_appno_uq
  ON recruitment.hrms_applications (tenant_id, application_no)
  WHERE application_no IS NOT NULL;

-- DB-ENFORCED duplicate prevention (R-RA-0100): at most one non-withdrawn
-- application per (tenant, vacancy, dedup_key). NULL dedup_key (multiples allowed
-- / legacy rows) is exempt. This makes the concurrent-apply race a hard 23505,
-- not a best-effort application-code check.
DROP INDEX IF EXISTS recruitment.hrms_applications_dup_idx;
CREATE UNIQUE INDEX IF NOT EXISTS hrms_applications_dedup_uq
  ON recruitment.hrms_applications (tenant_id, job_opening_id, dedup_key)
  WHERE dedup_key IS NOT NULL AND status <> 'withdrawn';

-- Case-insensitive duplicate lookup for the friendly pre-check.
CREATE INDEX IF NOT EXISTS hrms_applications_email_lower_idx
  ON recruitment.hrms_applications (tenant_id, job_opening_id, lower(email));
