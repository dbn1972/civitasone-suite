-- visitor-service initial migration: locations, areas, gates, parking_slots.
-- Applied with visitor_svc role on civitas_visitor.
-- L2 schema: visitor (this migration also introduces the schema itself).
--
-- Purpose: establish the location-configuration module (Locations, Restricted
-- Areas, Gates, Parking Slots) that all other visitor-service modules
-- (visit-request, digital-pass, check-in, material/vehicle-pass, evacuation)
-- reference via location_id / area_id / gate_id. Matches
-- modules/location/schema.ts in the design document exactly.
--
-- Rollback strategy (manual — no destructive statements are run forward):
--   1. DROP POLICY tenant_isolation ON visitor.parking_slots;
--      DROP POLICY tenant_isolation ON visitor.gates;
--      DROP POLICY tenant_isolation ON visitor.areas;
--      DROP POLICY tenant_isolation ON visitor.locations;
--   2. DROP TABLE IF EXISTS visitor.parking_slots;
--      DROP TABLE IF EXISTS visitor.gates;
--      DROP TABLE IF EXISTS visitor.areas;
--      DROP TABLE IF EXISTS visitor.locations;
--   3. DROP FUNCTION IF EXISTS current_tenant_id(); -- only if no other
--      visitor-service table still depends on it.
--   4. DROP SCHEMA IF EXISTS visitor; -- only once every table above is gone.
-- Affected services: visitor-service only (new schema, no cross-service impact).

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS visitor;

-- Shared RLS helper: reads the `app.tenant_id` GUC set per-request by the
-- tenant transaction hook (SET LOCAL app.tenant_id = '<tenant>').
-- Matches the canonical pattern documented in docs/DATABASE-SCHEMA.md.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT current_setting('app.tenant_id', true)::uuid $$;

-- ── visitor.locations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.locations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  name                varchar(200) NOT NULL,
  address             text,
  business_hours      jsonb       NOT NULL,
  capacity            integer     NOT NULL DEFAULT 500,
  capacity_threshold  integer     NOT NULL DEFAULT 450,
  active              boolean     NOT NULL DEFAULT true,
  rsa_public_key      text,                                   -- per-location public key (gate verification)
  rsa_private_key     text,                                   -- per-location private key (pass signing)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_visitor_locations_tenant
  ON visitor.locations (tenant_id);

ALTER TABLE visitor.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON visitor.locations;
CREATE POLICY tenant_isolation ON visitor.locations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── visitor.areas ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.areas (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  location_id           uuid        NOT NULL REFERENCES visitor.locations(id),
  name                  varchar(200) NOT NULL,
  security_level        integer     NOT NULL DEFAULT 1,       -- 1-5
  authorized_approvers  jsonb       NOT NULL DEFAULT '[]',
  escort_required       boolean     NOT NULL DEFAULT false,
  active                boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_by            uuid        NOT NULL,
  version               integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_visitor_areas_tenant_location
  ON visitor.areas (tenant_id, location_id);

ALTER TABLE visitor.areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.areas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON visitor.areas;
CREATE POLICY tenant_isolation ON visitor.areas
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── visitor.gates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.gates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  location_id  uuid        NOT NULL REFERENCES visitor.locations(id),
  area_id      uuid        REFERENCES visitor.areas(id),      -- null = perimeter gate
  name         varchar(100) NOT NULL,
  gate_type    varchar(12) NOT NULL DEFAULT 'entry_exit',     -- entry | exit | entry_exit
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  updated_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_visitor_gates_tenant_location
  ON visitor.gates (tenant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_visitor_gates_tenant_area
  ON visitor.gates (tenant_id, area_id);

ALTER TABLE visitor.gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.gates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON visitor.gates;
CREATE POLICY tenant_isolation ON visitor.gates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── visitor.parking_slots ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.parking_slots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  location_id   uuid        NOT NULL REFERENCES visitor.locations(id),
  slot_number   varchar(10) NOT NULL,
  category      varchar(16) NOT NULL,                         -- vip | standard | handicapped | two_wheeler | bus
  vehicle_type  varchar(16) NOT NULL,
  occupied      boolean     NOT NULL DEFAULT false,
  occupied_by   uuid,                                         -- vehicle_pass_id (cross-module, no FK: table added in 0004)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_visitor_parking_slots_tenant_location
  ON visitor.parking_slots (tenant_id, location_id);

ALTER TABLE visitor.parking_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.parking_slots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON visitor.parking_slots;
CREATE POLICY tenant_isolation ON visitor.parking_slots
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
