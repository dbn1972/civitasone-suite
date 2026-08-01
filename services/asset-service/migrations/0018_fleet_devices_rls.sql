-- Migration: 0018_fleet_devices_rls.sql
-- Purpose: facade-closure for asset-service fleet + fleet-devices modules.
--   fleet/routes.ts and fleet-devices/routes.ts published commands
--   (asset.fleet.create, asset.fleet_device.register,
--   asset.fleet_device.telemetry, asset.fleet.schedule_maintenance) with no
--   consumer.ts, so messages black-holed; GET handlers returned hardcoded
--   empty arrays; POST .../gps was a pure echo (no persistence).
-- This migration adds the missing fleet_devices + fleet_device_telemetry
-- tables, the odometer_threshold_km column asset.fleet_maintenance never had,
-- and RLS (the asset.* tables from 0017 had NONE — RLS was never applied).
-- Affected service: asset-service
-- Rollback: DROP TABLE IF EXISTS asset.fleet_device_telemetry;
--           DROP TABLE IF EXISTS asset.fleet_devices;
--           ALTER TABLE asset.fleet_maintenance DROP COLUMN IF EXISTS odometer_threshold_km;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS asset.fleet_devices (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  vehicle_id   uuid        NOT NULL REFERENCES asset.fleet_vehicles(id),
  device_imei  varchar(15) NOT NULL,
  protocol     varchar(16) NOT NULL,
  sim_iccid    varchar(32),
  status       varchar(16) NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1,
  CONSTRAINT uq_fleet_devices_tenant_imei UNIQUE (tenant_id, device_imei)
);

CREATE INDEX IF NOT EXISTS idx_fleet_devices_tenant  ON asset.fleet_devices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_devices_vehicle ON asset.fleet_devices (vehicle_id);

CREATE TABLE IF NOT EXISTS asset.fleet_device_telemetry (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  device_id      uuid        NOT NULL REFERENCES asset.fleet_devices(id),
  lat            numeric(10,7) NOT NULL,
  lng            numeric(10,7) NOT NULL,
  speed          numeric(6,2),
  heading        numeric(5,2),
  fuel_level_pct integer,
  engine_on      boolean,
  recorded_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_device_telemetry_tenant       ON asset.fleet_device_telemetry (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_device_telemetry_device_time  ON asset.fleet_device_telemetry (device_id, recorded_at DESC);

ALTER TABLE asset.fleet_maintenance ADD COLUMN IF NOT EXISTS odometer_threshold_km integer;
ALTER TABLE asset.fleet_maintenance ADD COLUMN IF NOT EXISTS created_by uuid;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- register.current_tenant_id() is the shared cross-schema GUC accessor used by
-- every other asset-service module (see 0007/0009/0016).

ALTER TABLE asset.fleet_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset.fleet_vehicles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON asset.fleet_vehicles;
CREATE POLICY tenant_isolation_policy ON asset.fleet_vehicles
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE asset.fleet_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset.fleet_trips FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON asset.fleet_trips;
CREATE POLICY tenant_isolation_policy ON asset.fleet_trips
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE asset.fleet_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset.fleet_maintenance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON asset.fleet_maintenance;
CREATE POLICY tenant_isolation_policy ON asset.fleet_maintenance
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE asset.fleet_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset.fleet_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON asset.fleet_devices;
CREATE POLICY tenant_isolation_policy ON asset.fleet_devices
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

ALTER TABLE asset.fleet_device_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset.fleet_device_telemetry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON asset.fleet_device_telemetry;
CREATE POLICY tenant_isolation_policy ON asset.fleet_device_telemetry
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
