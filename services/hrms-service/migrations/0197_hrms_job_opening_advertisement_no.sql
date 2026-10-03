-- 0197_hrms_job_opening_advertisement_no.sql
--
-- GAP-RECRUITMENT-HOME-05: advertisement / notification number of a vacancy (e.g. "Advt. No. 03/2026"),
-- distinct from ref_no (the internal reference). Nullable + additive + idempotent. Unique per tenant when
-- set (case-insensitive), so two vacancies cannot carry the same published number.
-- Rollback: DROP INDEX recruitment.ux_hrms_job_openings_advt_no;
--           ALTER TABLE recruitment.hrms_job_openings DROP COLUMN advertisement_no;

SET lock_timeout = '5s';

ALTER TABLE recruitment.hrms_job_openings ADD COLUMN IF NOT EXISTS advertisement_no varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS ux_hrms_job_openings_advt_no
  ON recruitment.hrms_job_openings (tenant_id, lower(advertisement_no))
  WHERE advertisement_no IS NOT NULL;
