-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0004_assignment_schema.sql
-- Service:   inspection-service (gateway /api/v1/inspection) — DB civitas_inspection
--
-- Purpose:
--   Creates the `assignment` schema and five tables for the Assignment module:
--     1. inspection_assignments — links inspectors to inspections with scheduling
--     2. conflict_declarations  — inspector conflict-of-interest declarations
--     3. tour_plans             — geographic tour scheduling for inspectors
--     4. geo_attendance         — GPS-verified attendance at inspection sites
--     5. inspector_capacity     — daily limits and competency records per inspector
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (schema, table, indexes) or guarded (policy via DROP-then-CREATE),
--   so it can be re-applied safely.
--
-- Row-level security (RLS):
--   All tables have BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so even the
--   table-owner role is subject to the policy. The tenant_isolation policy uses
--   the missing-ok GUC form `NULLIF(current_setting('app.tenant_id', true), '')::uuid`
--   so an UNSET GUC yields NULL (rows invisible — fail-closed) instead of raising.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP TABLE IF EXISTS assignment.inspector_capacity;
--   DROP TABLE IF EXISTS assignment.geo_attendance;
--   DROP TABLE IF EXISTS assignment.tour_plans;
--   DROP TABLE IF EXISTS assignment.conflict_declarations;
--   DROP TABLE IF EXISTS assignment.inspection_assignments;
--   DROP SCHEMA IF EXISTS assignment;
--
-- Affected services: inspection-service only (own database, no cross-service tables).
-- Requirements: 4.1, 4.2, 4.4, 4.5, 4.8
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS assignment;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 1: assignment.inspection_assignments
--   Links an inspector to an inspection with a scheduled date.
--   Status tracks the assignment lifecycle (assigned, accepted, completed, etc.).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assignment.inspection_assignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    inspection_id       UUID NOT NULL,
    inspector_id        UUID NOT NULL,
    inspection_type_id  UUID NOT NULL,
    entity_id           UUID NOT NULL,
    scheduled_date      DATE NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'assigned',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    version             INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 2: assignment.conflict_declarations
--   Records inspector conflict-of-interest declarations against entities.
--   The UNIQUE constraint ensures one declaration per inspector-entity pair
--   within a tenant.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assignment.conflict_declarations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    inspector_id        UUID NOT NULL,
    entity_id           UUID NOT NULL,
    relationship_type   VARCHAR(48) NOT NULL,
    declared_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uq_conflict_tenant_inspector_entity
        UNIQUE (tenant_id, inspector_id, entity_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 3: assignment.tour_plans
--   Defines a schedule of field visits for an inspector over a period.
--   The `slots` JSONB column stores an array of daily visit entries with
--   entity references and geographic coordinates for route optimization.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assignment.tour_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    inspector_id        UUID NOT NULL,
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    slots               JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    version             INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 4: assignment.geo_attendance
--   GPS-verified attendance records for inspector site visits.
--   Stores both inspector GPS and entity registered location for distance
--   validation. The location_mismatch flag (0/1) indicates geofence violation.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assignment.geo_attendance (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    inspection_id       UUID NOT NULL,
    inspector_id        UUID NOT NULL,
    latitude            NUMERIC(10, 7) NOT NULL,
    longitude           NUMERIC(10, 7) NOT NULL,
    entity_latitude     NUMERIC(10, 7) NOT NULL,
    entity_longitude    NUMERIC(10, 7) NOT NULL,
    distance_meters     INTEGER NOT NULL,
    geofence_radius     INTEGER NOT NULL,
    location_mismatch   INTEGER NOT NULL DEFAULT 0,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE 5: assignment.inspector_capacity
--   Stores configurable daily inspection limits and competency certifications
--   per inspector. Used to enforce capacity constraints during assignment.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assignment.inspector_capacity (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    inspector_id        UUID NOT NULL,
    daily_limit         INTEGER NOT NULL DEFAULT 4,
    competencies        JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    version             INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy on ALL tables.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policies are dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- inspection_assignments
ALTER TABLE assignment.inspection_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment.inspection_assignments FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON assignment.inspection_assignments;
CREATE POLICY tenant_isolation ON assignment.inspection_assignments
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- conflict_declarations
ALTER TABLE assignment.conflict_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment.conflict_declarations FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON assignment.conflict_declarations;
CREATE POLICY tenant_isolation ON assignment.conflict_declarations
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- tour_plans
ALTER TABLE assignment.tour_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment.tour_plans FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON assignment.tour_plans;
CREATE POLICY tenant_isolation ON assignment.tour_plans
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- geo_attendance
ALTER TABLE assignment.geo_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment.geo_attendance FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON assignment.geo_attendance;
CREATE POLICY tenant_isolation ON assignment.geo_attendance
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- inspector_capacity
ALTER TABLE assignment.inspector_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment.inspector_capacity FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON assignment.inspector_capacity;
CREATE POLICY tenant_isolation ON assignment.inspector_capacity
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Capacity check index: efficiently query an inspector's assignments on a given date
CREATE INDEX IF NOT EXISTS idx_assignments_tenant_inspector_date
    ON assignment.inspection_assignments(tenant_id, inspector_id, scheduled_date);

-- Lookup assignments by inspection
CREATE INDEX IF NOT EXISTS idx_assignments_tenant_inspection
    ON assignment.inspection_assignments(tenant_id, inspection_id);

-- Tour plan lookup by inspector
CREATE INDEX IF NOT EXISTS idx_tour_plans_tenant_inspector
    ON assignment.tour_plans(tenant_id, inspector_id);

-- Geo-attendance lookup by inspection
CREATE INDEX IF NOT EXISTS idx_geo_attendance_tenant_inspection
    ON assignment.geo_attendance(tenant_id, inspection_id);

-- Capacity lookup by inspector
CREATE INDEX IF NOT EXISTS idx_inspector_capacity_tenant_inspector
    ON assignment.inspector_capacity(tenant_id, inspector_id);
