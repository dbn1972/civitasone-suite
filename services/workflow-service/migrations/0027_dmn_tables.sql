-- Purpose: Create DMN decision tables for workflow service
-- Rollback: DROP TABLE IF EXISTS workflow.dmn_tables;
-- Affected services: workflow-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS workflow.dmn_tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(200) NOT NULL,
  description   varchar(2000),
  inputs        jsonb NOT NULL DEFAULT '[]'::jsonb,
  outputs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules         jsonb NOT NULL DEFAULT '[]'::jsonb,
  hit_policy    varchar(16) NOT NULL DEFAULT 'FIRST',
  version       integer NOT NULL DEFAULT 1,
  status        varchar(24) NOT NULL DEFAULT 'draft',
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dmn_tables_tenant ON workflow.dmn_tables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dmn_tables_status ON workflow.dmn_tables(tenant_id, status);
