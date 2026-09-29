-- Migration: 0027_water_connections_tables.sql
-- Purpose: facade-closure for asset-service's water-connections module.
--   water-connections/routes.ts publishes commands (asset.water.application.*,
--   asset.water.connection.*) but no consumer.ts was ever registered in
--   worker.ts, and no migration ever created a `water_connections` schema or
--   any table in it (confirmed by grepping every migration file) -- so POST
--   returns 202 {id,status:"accepted"} but nothing is ever persisted, and
--   GET list/by-id either 500s ("relation ... does not exist") or comes back
--   empty.
-- This migration creates the `water_connections` schema and its two tables
-- exactly matching the pre-existing src/modules/water-connections/schema.ts
-- Drizzle definitions, plus one additive column (rejection_reason -- see
-- schema.ts's own comment on it), RLS (FORCE + tenant_isolation_policy via
-- register.current_tenant_id(), the shared cross-schema GUC accessor -- see
-- 0007/0009/0016/0018/0026) and the standard audit columns.
-- Affected service: asset-service
-- Rollback: DROP TABLE IF EXISTS water_connections.asset_water_connections;
--           DROP TABLE IF EXISTS water_connections.asset_water_applications;
--           DROP SCHEMA IF EXISTS water_connections;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS water_connections;

-- ── asset_water_applications ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS water_connections.asset_water_applications (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  application_number  text        NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'draft',
  applicant_name      text        NOT NULL,
  applicant_phone     text        NOT NULL,
  property_id         text,
  connection_type     varchar(16) NOT NULL,
  pipe_size           varchar(16),
  address             jsonb,
  documents           jsonb,
  fee_minor           bigint      NOT NULL DEFAULT 0,
  fee_currency        char(3)     NOT NULL DEFAULT 'INR',
  fee_paid            boolean     NOT NULL DEFAULT false,
  fee_transaction_id  text,
  feasibility_report  jsonb,
  rejection_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_water_applications_tenant ON water_connections.asset_water_applications (tenant_id);

-- ── asset_water_connections ──────────────────────────────────────────────────
-- application_id FK is intra-module (same migration file, same PR) -- safe.
-- No FK to any OTHER module's tables is added anywhere in this migration:
-- this sweep ships water-connections/water-metering/water-tanker/streetlight
-- as 4 independent PRs that must be mergeable in any order, and a
-- cross-module FK would make this migration fail if the referenced table's
-- own migration (a different PR) had not merged first.

CREATE TABLE IF NOT EXISTS water_connections.asset_water_connections (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  connection_number  text        NOT NULL,
  application_id     uuid        NOT NULL REFERENCES water_connections.asset_water_applications(id),
  meter_id           text,
  status             varchar(16) NOT NULL DEFAULT 'active',
  connection_type    varchar(16) NOT NULL,
  pipe_size          varchar(16),
  installation_date  date,
  activation_date    date,
  address            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_water_connections_tenant      ON water_connections.asset_water_connections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_water_connections_application ON water_connections.asset_water_connections (application_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE water_connections.asset_water_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_connections.asset_water_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON water_connections.asset_water_applications;
CREATE POLICY tenant_isolation_policy ON water_connections.asset_water_applications
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE water_connections.asset_water_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_connections.asset_water_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON water_connections.asset_water_connections;
CREATE POLICY tenant_isolation_policy ON water_connections.asset_water_connections
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
