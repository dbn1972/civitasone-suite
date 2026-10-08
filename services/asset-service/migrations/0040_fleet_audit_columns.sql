-- Migration: 0040_fleet_audit_columns.sql
-- GAP2-ASSETS-FLEET-SCHEMA-01. Additive + idempotent.
-- The fleet tables omitted the mandatory per-entity audit columns required by
-- CLAUDE.md §3.6 (id, tenantId, createdAt, updatedAt, createdBy, updatedBy,
-- version). fleet_vehicles / fleet_devices had created_at/created_by/version
-- but no updated_at/updated_by; fleet_maintenance had only created_at (+ a
-- nullable created_by from 0018), no updated_at/updated_by/version;
-- fleet_device_telemetry (append-only) lacked them too. Vehicles and
-- maintenance jobs are mutated in place (status, odometer, driver, GPS,
-- completion), so without these columns the row never records who last changed
-- it. This adds them and back-fills existing rows so NOT NULL defaults are
-- consistent with the create columns.
--
-- Rollback:
--   ALTER TABLE asset.fleet_vehicles          DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE asset.fleet_devices           DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE asset.fleet_maintenance       DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS version;
--   ALTER TABLE asset.fleet_device_telemetry  DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS updated_by;

SET lock_timeout = '5s';

-- fleet_vehicles: add updated_at / updated_by (already has created_at/by + version).
ALTER TABLE asset.fleet_vehicles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE asset.fleet_vehicles ADD COLUMN IF NOT EXISTS updated_by uuid;
-- Back-fill: a never-updated row's last writer is its creator.
UPDATE asset.fleet_vehicles SET updated_by = created_by WHERE updated_by IS NULL;

-- fleet_devices: same.
ALTER TABLE asset.fleet_devices ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE asset.fleet_devices ADD COLUMN IF NOT EXISTS updated_by uuid;
UPDATE asset.fleet_devices SET updated_by = created_by WHERE updated_by IS NULL;

-- fleet_maintenance: add updated_at / updated_by / version (mutated on completion/cancel).
ALTER TABLE asset.fleet_maintenance ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE asset.fleet_maintenance ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE asset.fleet_maintenance ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
UPDATE asset.fleet_maintenance SET updated_by = created_by WHERE updated_by IS NULL AND created_by IS NOT NULL;

-- fleet_device_telemetry: append-only, but the standard entity shape still
-- requires updated_at/updated_by for schema-drift parity with the drizzle model.
ALTER TABLE asset.fleet_device_telemetry ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE asset.fleet_device_telemetry ADD COLUMN IF NOT EXISTS updated_by uuid;
