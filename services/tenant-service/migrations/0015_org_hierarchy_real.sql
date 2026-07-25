-- Migration: 0015_org_hierarchy_real.sql
-- Purpose: Real org_units + data_migrations + reconciliations tables
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS tenant.org_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  parent_id   uuid,
  name        varchar(200) NOT NULL,
  type        varchar(32) NOT NULL CHECK (type IN ('department','division','section','unit','branch')),
  level       int NOT NULL DEFAULT 1,
  head_user_id uuid,
  code        varchar(32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  version     int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_org_units_tenant ON tenant.org_units (tenant_id);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON tenant.org_units (tenant_id, parent_id);

CREATE TABLE IF NOT EXISTS tenant.data_migrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  source_tenant_id uuid NOT NULL,
  target_tenant_id uuid NOT NULL,
  entities         jsonb NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'pending',
  dry_run          varchar(5) NOT NULL DEFAULT 'true',
  records_migrated int NOT NULL DEFAULT 0,
  errors           jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  created_by       uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_data_migrations_tenant ON tenant.data_migrations (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.reconciliations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_type   varchar(64) NOT NULL,
  source_system varchar(64) NOT NULL,
  status        varchar(24) NOT NULL DEFAULT 'pending',
  break_count   int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reconciliations_tenant ON tenant.reconciliations (tenant_id);
