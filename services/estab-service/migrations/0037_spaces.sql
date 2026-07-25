-- 0037: Spaces module — office building/floor/room/seat inventory, occupancy,
-- seat/room allotment (maker-checker), vacation/release, licence-fee where
-- applicable, and maintenance requests (SVC-058 general office-space gap).
--
-- New PG schema: spaces
-- New tables:
--   spaces.estab_buildings            — building inventory
--   spaces.estab_floors               — floors within a building
--   spaces.estab_office_rooms         — office rooms within a floor
--   spaces.estab_seats                — seats/workspaces within a room
--   spaces.estab_space_allotments     — request->allot->occupy->release workflow
--   spaces.estab_maintenance_requests — maintenance against building/floor/room/seat
--
-- Additive + idempotent (IF NOT EXISTS throughout). Money: bigint paise.
-- Timestamps: timestamptz. Optimistic locking via version.
-- RLS mirrors 0029: ENABLE + FORCE + tenant_isolation_policy (USING + WITH CHECK)
-- using current_tenant_id() (defined in 0029, applied before this file).
--
-- Rollback: DROP SCHEMA spaces CASCADE;  (destroys all 6 tables — use only if never populated)

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS spaces;

-- ─── (a) Buildings ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spaces.estab_buildings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT,
  org_unit      VARCHAR(64),
  status        VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INT NOT NULL DEFAULT 1
);
ALTER TABLE spaces.estab_buildings DROP CONSTRAINT IF EXISTS chk_building_status;
ALTER TABLE spaces.estab_buildings
  ADD CONSTRAINT chk_building_status CHECK (status IN ('active','inactive','condemned'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_buildings_tenant_code
  ON spaces.estab_buildings (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_estab_buildings_tenant_status
  ON spaces.estab_buildings (tenant_id, status);

-- ─── (b) Floors ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spaces.estab_floors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  building_id   UUID NOT NULL,
  floor_no      INTEGER NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_floors_tenant_building_no
  ON spaces.estab_floors (tenant_id, building_id, floor_no);
CREATE INDEX IF NOT EXISTS idx_estab_floors_tenant_building
  ON spaces.estab_floors (tenant_id, building_id);

-- ─── (c) Office rooms ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spaces.estab_office_rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  floor_id      UUID NOT NULL,
  room_no       TEXT NOT NULL,
  name          TEXT,
  room_type     VARCHAR(24) NOT NULL DEFAULT 'office',
  capacity      INTEGER NOT NULL DEFAULT 1,
  status        VARCHAR(24) NOT NULL DEFAULT 'available',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INT NOT NULL DEFAULT 1
);
ALTER TABLE spaces.estab_office_rooms DROP CONSTRAINT IF EXISTS chk_office_room_type;
ALTER TABLE spaces.estab_office_rooms
  ADD CONSTRAINT chk_office_room_type CHECK (room_type IN ('office','cabin','conference','store','utility'));
ALTER TABLE spaces.estab_office_rooms DROP CONSTRAINT IF EXISTS chk_office_room_status;
ALTER TABLE spaces.estab_office_rooms
  ADD CONSTRAINT chk_office_room_status CHECK (status IN ('available','full','closed'));
ALTER TABLE spaces.estab_office_rooms DROP CONSTRAINT IF EXISTS chk_office_room_capacity;
ALTER TABLE spaces.estab_office_rooms
  ADD CONSTRAINT chk_office_room_capacity CHECK (capacity >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_office_rooms_tenant_floor_no
  ON spaces.estab_office_rooms (tenant_id, floor_id, room_no);
CREATE INDEX IF NOT EXISTS idx_estab_office_rooms_tenant_floor
  ON spaces.estab_office_rooms (tenant_id, floor_id);

-- ─── (d) Seats / workspaces ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spaces.estab_seats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  room_id       UUID NOT NULL,
  seat_no       TEXT NOT NULL,
  seat_type     VARCHAR(24) NOT NULL DEFAULT 'workstation',
  status        VARCHAR(24) NOT NULL DEFAULT 'available',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INT NOT NULL DEFAULT 1
);
ALTER TABLE spaces.estab_seats DROP CONSTRAINT IF EXISTS chk_seat_type;
ALTER TABLE spaces.estab_seats
  ADD CONSTRAINT chk_seat_type CHECK (seat_type IN ('workstation','cabin','hot_desk','cubicle'));
ALTER TABLE spaces.estab_seats DROP CONSTRAINT IF EXISTS chk_seat_status;
ALTER TABLE spaces.estab_seats
  ADD CONSTRAINT chk_seat_status CHECK (status IN ('available','allotted','blocked'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_seats_tenant_room_no
  ON spaces.estab_seats (tenant_id, room_id, seat_no);
CREATE INDEX IF NOT EXISTS idx_estab_seats_tenant_room
  ON spaces.estab_seats (tenant_id, room_id);
CREATE INDEX IF NOT EXISTS idx_estab_seats_tenant_status
  ON spaces.estab_seats (tenant_id, status);

-- ─── (e) Space allotments (request->allot->occupy->release) ──────────────────
CREATE TABLE IF NOT EXISTS spaces.estab_space_allotments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  target_type       VARCHAR(16) NOT NULL,
  target_id         UUID NOT NULL,
  employee_ref      UUID,
  org_unit          VARCHAR(64),
  purpose           TEXT,
  status            VARCHAR(24) NOT NULL DEFAULT 'requested',
  requested_by      UUID NOT NULL,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  allotted_by       UUID,
  allotted_at       TIMESTAMPTZ,
  occupied_at       TIMESTAMPTZ,
  released_at       TIMESTAMPTZ,
  release_reason    TEXT,
  cancel_reason     TEXT,
  cancelled_at      TIMESTAMPTZ,
  licence_fee_minor BIGINT NOT NULL DEFAULT 0,
  currency          CHAR(3) NOT NULL DEFAULT 'INR',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID NOT NULL,
  updated_by        UUID NOT NULL,
  version           INT NOT NULL DEFAULT 1
);
ALTER TABLE spaces.estab_space_allotments DROP CONSTRAINT IF EXISTS chk_space_allotment_target;
ALTER TABLE spaces.estab_space_allotments
  ADD CONSTRAINT chk_space_allotment_target CHECK (target_type IN ('seat','room'));
ALTER TABLE spaces.estab_space_allotments DROP CONSTRAINT IF EXISTS chk_space_allotment_status;
ALTER TABLE spaces.estab_space_allotments
  ADD CONSTRAINT chk_space_allotment_status CHECK (
    status IN ('requested','allotted','occupied','released','cancelled')
  );
ALTER TABLE spaces.estab_space_allotments DROP CONSTRAINT IF EXISTS chk_space_allotment_subject;
ALTER TABLE spaces.estab_space_allotments
  ADD CONSTRAINT chk_space_allotment_subject CHECK (employee_ref IS NOT NULL OR org_unit IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_estab_space_allot_tenant_target
  ON spaces.estab_space_allotments (tenant_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_estab_space_allot_tenant_status
  ON spaces.estab_space_allotments (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_estab_space_allot_tenant_employee
  ON spaces.estab_space_allotments (tenant_id, employee_ref);
-- DB backstop: at most one active (allotted/occupied) allotment per seat.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_active_seat_allotment
  ON spaces.estab_space_allotments (tenant_id, target_id)
  WHERE target_type = 'seat' AND status IN ('allotted','occupied');

-- ─── (f) Maintenance requests ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spaces.estab_maintenance_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  asset_type        VARCHAR(16) NOT NULL,
  asset_id          UUID NOT NULL,
  category          VARCHAR(24) NOT NULL DEFAULT 'other',
  priority          VARCHAR(16) NOT NULL DEFAULT 'medium',
  description       TEXT NOT NULL,
  status            VARCHAR(24) NOT NULL DEFAULT 'open',
  reported_by       UUID NOT NULL,
  assigned_to       UUID,
  reported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID NOT NULL,
  updated_by        UUID NOT NULL,
  version           INT NOT NULL DEFAULT 1
);
ALTER TABLE spaces.estab_maintenance_requests DROP CONSTRAINT IF EXISTS chk_maint_asset_type;
ALTER TABLE spaces.estab_maintenance_requests
  ADD CONSTRAINT chk_maint_asset_type CHECK (asset_type IN ('building','floor','room','seat'));
ALTER TABLE spaces.estab_maintenance_requests DROP CONSTRAINT IF EXISTS chk_maint_priority;
ALTER TABLE spaces.estab_maintenance_requests
  ADD CONSTRAINT chk_maint_priority CHECK (priority IN ('low','medium','high','critical'));
ALTER TABLE spaces.estab_maintenance_requests DROP CONSTRAINT IF EXISTS chk_maint_status;
ALTER TABLE spaces.estab_maintenance_requests
  ADD CONSTRAINT chk_maint_status CHECK (status IN ('open','assigned','in_progress','resolved','closed','cancelled'));
CREATE INDEX IF NOT EXISTS idx_estab_maint_tenant_asset
  ON spaces.estab_maintenance_requests (tenant_id, asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_estab_maint_tenant_status
  ON spaces.estab_maintenance_requests (tenant_id, status);

-- ─── RLS policies (mirror 0029: ENABLE + FORCE + USING/WITH CHECK) ───────────
DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'estab_buildings','estab_floors','estab_office_rooms','estab_seats',
    'estab_space_allotments','estab_maintenance_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE spaces.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE spaces.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON spaces.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON spaces.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $rls$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA spaces TO estab_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA spaces TO estab_svc;
