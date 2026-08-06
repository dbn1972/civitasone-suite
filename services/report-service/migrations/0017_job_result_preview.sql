-- Migration: 0017_job_result_preview.sql
-- Purpose: Persist a bounded, PII-masked result preview on report jobs so the
--          web preview shows real data (previously the detail endpoint
--          hardcoded columns: [], rows: [] and preview was always empty).
-- Rollback: ALTER TABLE reports.jobs DROP COLUMN IF EXISTS result_columns;
--           ALTER TABLE reports.jobs DROP COLUMN IF EXISTS result_preview;
-- Affected services: report-service

SET lock_timeout = '5s';

ALTER TABLE reports.jobs
  ADD COLUMN IF NOT EXISTS result_columns jsonb DEFAULT NULL;

ALTER TABLE reports.jobs
  ADD COLUMN IF NOT EXISTS result_preview jsonb DEFAULT NULL;

COMMENT ON COLUMN reports.jobs.result_columns IS 'JSON array of column header strings, written at render completion';
COMMENT ON COLUMN reports.jobs.result_preview IS 'JSON array (max 100) of header-keyed, string-valued rows — PII-masked at render time';
