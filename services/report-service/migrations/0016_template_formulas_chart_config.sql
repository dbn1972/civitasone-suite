-- Purpose: Add formulas and chart_config JSONB columns to report_templates for computed columns and chart rendering.
-- Rollback: ALTER TABLE reports.report_templates DROP COLUMN IF EXISTS formulas; ALTER TABLE reports.report_templates DROP COLUMN IF EXISTS chart_config;
-- Affected services: report-service

SET lock_timeout = '5s';

ALTER TABLE reports.report_templates
  ADD COLUMN IF NOT EXISTS formulas JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE reports.report_templates
  ADD COLUMN IF NOT EXISTS chart_config JSONB;
