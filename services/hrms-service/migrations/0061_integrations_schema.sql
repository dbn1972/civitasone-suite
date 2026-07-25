-- Migration: 0061_integrations_schema.sql
-- Purpose: Add integrations and sync log tables for external HR system connectivity.
-- Rollback: DROP TABLE IF EXISTS employee.integration_sync_log; DROP TABLE IF EXISTS employee.integrations;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee.integrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(128) NOT NULL,
  type          varchar(32) NOT NULL CHECK (type IN ('ehrms','pfms_payroll','digilocker','biometric','custom')),
  config        jsonb NOT NULL DEFAULT '{}',
  status        varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','error')),
  last_sync_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON employee.integrations (tenant_id);

CREATE TABLE IF NOT EXISTS employee.integration_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  integration_id  uuid NOT NULL REFERENCES employee.integrations(id),
  status          varchar(16) NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  records_synced  int NOT NULL DEFAULT 0,
  errors          jsonb NOT NULL DEFAULT '[]',
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sync_log_integration ON employee.integration_sync_log (integration_id, started_at DESC);
