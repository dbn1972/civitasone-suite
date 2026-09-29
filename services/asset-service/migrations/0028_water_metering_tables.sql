-- Migration: 0028_water_metering_tables.sql
-- Purpose: facade-closure for asset-service's water-metering module.
--   water-metering/routes.ts publishes commands (asset.water.meter_reading.*,
--   asset.water.bill.*, asset.water.service_request.*) but no consumer.ts
--   was ever registered in worker.ts, and no migration ever created a
--   `water_metering` schema or any table in it (confirmed by grepping every
--   migration file) -- so POST returns 202 {id,status:"accepted"} but
--   nothing is ever persisted, and GET list/by-id 500s ("relation ... does
--   not exist"). This exact gap is what tests/comp-007-asset-water-smoke.test.ts
--   documented as a KNOWN ISSUE (see that file's update in this same PR).
-- This migration creates the `water_metering` schema and its three tables
-- exactly matching the pre-existing src/modules/water-metering/schema.ts
-- Drizzle definitions, plus RLS (FORCE + tenant_isolation_policy via
-- register.current_tenant_id(), the shared cross-schema GUC accessor -- see
-- 0007/0009/0016/0018/0026/0027) and the standard audit columns.
-- Affected service: asset-service
-- Rollback: DROP TABLE IF EXISTS water_metering.asset_water_service_requests;
--           DROP TABLE IF EXISTS water_metering.asset_water_bills;
--           DROP TABLE IF EXISTS water_metering.asset_water_meter_readings;
--           DROP SCHEMA IF EXISTS water_metering;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS water_metering;

-- ── asset_water_meter_readings ───────────────────────────────────────────────
-- connection_id intentionally has NO foreign key to water_connections'
-- table: this sweep ships water-connections/water-metering/water-tanker/
-- streetlight as 4 independent PRs that must be mergeable in any order, and
-- a cross-module FK would make this migration fail if water-connections'
-- own migration (a different PR) had not merged first.

CREATE TABLE IF NOT EXISTS water_metering.asset_water_meter_readings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  connection_id     uuid        NOT NULL,
  reading_date      date        NOT NULL,
  previous_reading  numeric     NOT NULL,
  current_reading   numeric     NOT NULL,
  consumption       numeric     NOT NULL,
  unit              varchar(16) NOT NULL DEFAULT 'kl',
  reader_id         uuid,
  photo             text,
  status            varchar(16) NOT NULL DEFAULT 'pending',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_water_meter_readings_tenant      ON water_metering.asset_water_meter_readings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_water_meter_readings_connection  ON water_metering.asset_water_meter_readings (connection_id);

-- ── asset_water_bills ─────────────────────────────────────────────────────────
-- reading_id has no FK either -- it references a row in the SAME schema
-- (water_metering.asset_water_meter_readings, created just above), so unlike
-- connection_id there is no merge-ordering concern here. Left unconstrained
-- anyway to match the pre-existing schema.ts (nullable, no relation
-- declared) rather than introducing a constraint schema.ts never had.

CREATE TABLE IF NOT EXISTS water_metering.asset_water_bills (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  connection_id    uuid        NOT NULL,
  bill_number      text        NOT NULL,
  billing_period   varchar(32),
  reading_id       uuid,
  consumption_kl   numeric     NOT NULL,
  rate_per_kl      bigint      NOT NULL,
  amount_minor     bigint      NOT NULL,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  tax_minor        bigint      NOT NULL DEFAULT 0,
  total_minor      bigint      NOT NULL,
  due_date         date        NOT NULL,
  status           varchar(16) NOT NULL DEFAULT 'generated',
  payment_date     timestamptz,
  payment_ref      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_water_bills_tenant      ON water_metering.asset_water_bills (tenant_id);
CREATE INDEX IF NOT EXISTS idx_water_bills_connection  ON water_metering.asset_water_bills (connection_id);

-- ── asset_water_service_requests ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS water_metering.asset_water_service_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  connection_id  uuid        NOT NULL,
  request_type   varchar(32) NOT NULL,
  description    text,
  status         varchar(16) NOT NULL DEFAULT 'open',
  assigned_to    uuid,
  resolved_at    timestamptz,
  resolution     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_water_service_requests_tenant      ON water_metering.asset_water_service_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_water_service_requests_connection  ON water_metering.asset_water_service_requests (connection_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE water_metering.asset_water_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_metering.asset_water_meter_readings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON water_metering.asset_water_meter_readings;
CREATE POLICY tenant_isolation_policy ON water_metering.asset_water_meter_readings
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE water_metering.asset_water_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_metering.asset_water_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON water_metering.asset_water_bills;
CREATE POLICY tenant_isolation_policy ON water_metering.asset_water_bills
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE water_metering.asset_water_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_metering.asset_water_service_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON water_metering.asset_water_service_requests;
CREATE POLICY tenant_isolation_policy ON water_metering.asset_water_service_requests
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
