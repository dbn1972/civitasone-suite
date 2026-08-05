-- Migration: 0016_template_watermark_pii.sql
-- Purpose: Add watermark and pii_columns fields to report_templates for controlled exports.
-- Rollback: ALTER TABLE reports.report_templates DROP COLUMN IF EXISTS watermark;
--           ALTER TABLE reports.report_templates DROP COLUMN IF EXISTS pii_columns;
-- Affected services: report-service

SET lock_timeout = '5s';

ALTER TABLE reports.report_templates
  ADD COLUMN IF NOT EXISTS watermark varchar(200) DEFAULT NULL;

ALTER TABLE reports.report_templates
  ADD COLUMN IF NOT EXISTS pii_columns jsonb DEFAULT NULL;

COMMENT ON COLUMN reports.report_templates.watermark IS 'Optional watermark text overlaid on PDF exports or prepended to XLSX/CSV';
COMMENT ON COLUMN reports.report_templates.pii_columns IS 'JSON array of column keys containing PII that should be masked for non-privileged roles';
