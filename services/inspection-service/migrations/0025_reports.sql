-- Migration: 0025_reports.sql
-- Purpose: Inspection reports and observations tracking.
-- Rollback: DROP SCHEMA reports CASCADE;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS reports;
GRANT USAGE ON SCHEMA reports TO inspection_svc;

CREATE TABLE IF NOT EXISTS reports.inspection_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  inspection_id   uuid NOT NULL,
  entity_id       uuid NOT NULL,
  inspector_id    uuid NOT NULL,
  report_type     varchar(32) NOT NULL DEFAULT 'standard',
  status          varchar(24) NOT NULL DEFAULT 'draft',
  summary         text,
  recommendations text,
  overall_grade   varchar(8),
  submitted_at    timestamptz,
  approved_at     timestamptz,
  approved_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_report_status CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_tenant
  ON reports.inspection_reports (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_inspection
  ON reports.inspection_reports (tenant_id, inspection_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_status
  ON reports.inspection_reports (tenant_id, status);

CREATE TABLE IF NOT EXISTS reports.observations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  report_id   uuid NOT NULL REFERENCES reports.inspection_reports(id),
  category    varchar(64) NOT NULL,
  severity    varchar(16) NOT NULL DEFAULT 'minor',
  description text NOT NULL,
  location    text,
  evidence_ids text[],
  status      varchar(24) NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  CONSTRAINT chk_observation_severity CHECK (severity IN ('critical', 'major', 'minor', 'observation')),
  CONSTRAINT chk_observation_status CHECK (status IN ('open', 'closed', 'deferred'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_observations_report
  ON reports.observations (tenant_id, report_id);

ALTER TABLE reports.inspection_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.observations        ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_reports ON reports.inspection_reports
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY rls_observations ON reports.observations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON reports.inspection_reports TO inspection_svc;
GRANT SELECT, INSERT, UPDATE ON reports.observations        TO inspection_svc;
