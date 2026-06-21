-- report-service: add missing columns to reports.jobs to satisfy ReportJobSummarySchema
ALTER TABLE reports.jobs
  ADD COLUMN IF NOT EXISTS format        varchar(16)  NOT NULL DEFAULT 'pdf',
  ADD COLUMN IF NOT EXISTS row_count     integer,
  ADD COLUMN IF NOT EXISTS requested_by  uuid,
  ADD COLUMN IF NOT EXISTS completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS download_url  varchar(1024);

-- Fix status default to match the enum used by the frontend
ALTER TABLE reports.jobs ALTER COLUMN status SET DEFAULT 'queued';
