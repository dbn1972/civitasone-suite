-- 0020_job_result_detail_schedule_soft_delete.sql
-- (1) reports.jobs: persist what the job detail screen shows. The detail route
--     always returned empty columns/rows/parameters because nothing was stored.
--     parameters = the request parameters; result_columns / result_rows = a
--     bounded preview of the (PII-masked) rows the render pipeline produced.
-- (2) reports.scheduled_reports: DELETE used to set enabled=false and the list
--     only returned enabled rows, so a merely DISABLED schedule vanished and
--     could not be re-enabled. deleted_at distinguishes a deleted schedule
--     (hidden) from a disabled one (listed with its status, re-enableable).
ALTER TABLE reports.jobs
  ADD COLUMN IF NOT EXISTS parameters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS result_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS result_rows    jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE reports.scheduled_reports
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
