-- Migration: 0004_material_vehicle_passes.sql
-- Purpose: Material and vehicle pass entities for visitor-service
--          (visitor.material_passes, visitor.vehicle_passes) per the design's
--          Drizzle schema (modules/material-pass/schema.ts, modules/vehicle-pass/schema.ts)
-- Depends on: 0001_locations_areas_gates_parking.sql (visitor.locations),
--             0002_visit_requests_digital_passes.sql (visitor.digital_passes)
-- Rollback: DROP TABLE IF EXISTS visitor.vehicle_passes; DROP TABLE IF EXISTS visitor.material_passes;
--           (both are leaf tables referencing digital_passes/locations only — no FKs point to them)
-- Safety: additive, idempotent (IF NOT EXISTS throughout). Safe to re-run.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS visitor;

-- ── material_passes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.material_passes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  pass_id             uuid        NOT NULL REFERENCES visitor.digital_passes(id),
  location_id         uuid        NOT NULL REFERENCES visitor.locations(id),
  item_description    text        NOT NULL,
  serial_number       varchar(64),
  quantity            integer     NOT NULL DEFAULT 1,
  direction           varchar(4)  NOT NULL CHECK (direction IN ('in', 'out')),
  reconciled_at       timestamptz,
  discrepancy         boolean     NOT NULL DEFAULT false,
  incident_id         uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL
);

ALTER TABLE visitor.material_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.material_passes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.material_passes;
DROP POLICY IF EXISTS tenant_isolation ON visitor.material_passes;
CREATE POLICY tenant_isolation_policy ON visitor.material_passes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_material_passes_tenant_pass
  ON visitor.material_passes (tenant_id, pass_id);

-- ── vehicle_passes ──────────────────────────────────────────────────────────
-- driver_name is an encrypted PII column, stored as TEXT holding the
-- AES-256-GCM ciphertext envelope produced by shared/pii-crypto.ts
-- encryptedText(), matching the convention used elsewhere in this schema
-- (e.g. visitor.visit_requests visitor_name/visitor_phone).
CREATE TABLE IF NOT EXISTS visitor.vehicle_passes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  pass_id              uuid        NOT NULL REFERENCES visitor.digital_passes(id),
  location_id          uuid        NOT NULL REFERENCES visitor.locations(id),
  registration_number  varchar(20) NOT NULL,
  vehicle_type         varchar(16) NOT NULL CHECK (vehicle_type IN ('two_wheeler', 'car', 'suv', 'bus', 'truck')),
  driver_name          text,       -- encrypted (enc:v2:... envelope), nullable
  parking_slot_id      uuid,
  status               varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_in', 'checked_out', 'expired')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid        NOT NULL,
  version              integer     NOT NULL DEFAULT 1
);

ALTER TABLE visitor.vehicle_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.vehicle_passes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.vehicle_passes;
DROP POLICY IF EXISTS tenant_isolation ON visitor.vehicle_passes;
CREATE POLICY tenant_isolation_policy ON visitor.vehicle_passes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_vehicle_passes_tenant_pass
  ON visitor.vehicle_passes (tenant_id, pass_id);
