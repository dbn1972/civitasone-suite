-- Purpose: Add report_templates table for parameterized report builder (Req 18.1, 18.2)
-- Rollback: DROP TABLE IF EXISTS reports.report_templates; DROP TYPE IF EXISTS report_output_format; DROP TYPE IF EXISTS report_template_status;
-- Affected services: report-service

SET lock_timeout = '5s';

-- Create enum types if they don't exist
DO $$ BEGIN
  CREATE TYPE report_output_format AS ENUM ('pdf', 'xlsx', 'csv');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_template_status AS ENUM ('active', 'draft', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS reports.report_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            VARCHAR(200) NOT NULL,
  description     VARCHAR(1000),
  data_source_id  VARCHAR(128) NOT NULL,
  filters         JSONB NOT NULL DEFAULT '[]'::jsonb,
  groups          JSONB NOT NULL DEFAULT '[]'::jsonb,
  aggregations    JSONB NOT NULL DEFAULT '[]'::jsonb,
  parameters      JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_format   VARCHAR(8) NOT NULL DEFAULT 'pdf',
  status          VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_report_templates_tenant ON reports.report_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_templates_tenant_status ON reports.report_templates(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_report_templates_data_source ON reports.report_templates(data_source_id);

-- CHECK constraints
ALTER TABLE reports.report_templates
  DROP CONSTRAINT IF EXISTS chk_report_templates_output_format;
ALTER TABLE reports.report_templates
  ADD CONSTRAINT chk_report_templates_output_format CHECK (output_format IN ('pdf', 'xlsx', 'csv'));

ALTER TABLE reports.report_templates
  DROP CONSTRAINT IF EXISTS chk_report_templates_status;
ALTER TABLE reports.report_templates
  ADD CONSTRAINT chk_report_templates_status CHECK (status IN ('active', 'draft', 'archived'));

-- RLS enforcement
ALTER TABLE reports.report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.report_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON reports.report_templates;
CREATE POLICY tenant_isolation ON reports.report_templates
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
