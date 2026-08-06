-- Purpose: G17 — Due-horizon work-queue generator tables.
--   crm.due_horizon_configs: tenant-configurable horizon sweep definitions.
--   crm.due_horizon_runs: audit of each sweep execution.
-- Rollback: DROP TABLE IF EXISTS crm.due_horizon_runs; DROP TABLE IF EXISTS crm.due_horizon_configs;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.due_horizon_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(200) NOT NULL,
  horizons      jsonb NOT NULL DEFAULT '[60, 30, 7]',
  group_by      varchar(20) NOT NULL DEFAULT 'product',
  consent_required boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  version       int NOT NULL DEFAULT 1,
  created_by    uuid NOT NULL,
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_group_by CHECK (group_by IN ('product', 'region', 'owner'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_due_horizon_configs_tenant
  ON crm.due_horizon_configs (tenant_id) WHERE active = true;

CREATE TABLE IF NOT EXISTS crm.due_horizon_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  config_id       uuid NOT NULL REFERENCES crm.due_horizon_configs(id),
  horizon_days    int NOT NULL,
  run_at          timestamptz NOT NULL DEFAULT now(),
  items_generated int NOT NULL DEFAULT 0,
  status          varchar(16) NOT NULL DEFAULT 'completed',
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_run_status CHECK (status IN ('completed', 'failed'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_due_horizon_runs_config
  ON crm.due_horizon_runs (config_id, run_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_due_horizon_runs_tenant
  ON crm.due_horizon_runs (tenant_id, run_at DESC);
