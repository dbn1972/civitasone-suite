-- Migration: 0014_land_cadastral_rls.sql
-- Purpose (SVC-113): make land-parcel + cadastral registries real & tenant-isolated.
--   * Retrofit FORCE RLS + tenant_isolation policy onto existing land/infra tables.
--   * Add cadastral parcel/survey/dispute/history tables with RLS + PostGIS boundary geom.
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table; DISABLE ROW LEVEL SECURITY;
--           DROP TABLE location.cadastral_parcel_history, cadastral_disputes, cadastral_surveys, cadastral_parcels.
SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- RLS retrofit: land_records, infrastructure_assets, infrastructure_inspections
-- ---------------------------------------------------------------------------
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['land_records','infrastructure_assets','infrastructure_inspections'] LOOP
    EXECUTE format('ALTER TABLE location.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE location.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON location.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON location.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $rls$;

-- ---------------------------------------------------------------------------
-- Cadastral parcels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location.cadastral_parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parcel_no varchar(64) NOT NULL,
  village varchar(128) NOT NULL,
  district varchar(128) NOT NULL,
  area_square_meters numeric(14,2) NOT NULL,
  boundary jsonb NOT NULL,
  geom geometry(Polygon, 4326),
  land_use varchar(32) NOT NULL CHECK (land_use IN ('agricultural','residential','commercial','industrial','forest','wetland','barren')),
  ownership_type varchar(32) NOT NULL CHECK (ownership_type IN ('private','government','community','temple_trust')),
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cadastral_parcels_tenant ON location.cadastral_parcels (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cadastral_parcels_lookup ON location.cadastral_parcels (tenant_id, village, district);
CREATE INDEX IF NOT EXISTS idx_cadastral_parcels_geom ON location.cadastral_parcels USING GIST (geom);

CREATE TABLE IF NOT EXISTS location.cadastral_parcel_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parcel_id uuid NOT NULL,
  event_type varchar(32) NOT NULL,
  detail jsonb,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cadastral_history_parcel ON location.cadastral_parcel_history (tenant_id, parcel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS location.cadastral_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parcel_ids jsonb NOT NULL,
  surveyor_id uuid NOT NULL,
  scheduled_date timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cadastral_surveys_tenant ON location.cadastral_surveys (tenant_id);

CREATE TABLE IF NOT EXISTS location.cadastral_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parcel_a_id uuid NOT NULL,
  parcel_b_id uuid NOT NULL,
  description varchar(2000) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'filed',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cadastral_disputes_tenant ON location.cadastral_disputes (tenant_id);

-- RLS for new cadastral tables
DO $rls2$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cadastral_parcels','cadastral_parcel_history','cadastral_surveys','cadastral_disputes'] LOOP
    EXECUTE format('ALTER TABLE location.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE location.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON location.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON location.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $rls2$;

-- Grants to the app role (default privileges usually cover this; explicit for safety)
GRANT SELECT, INSERT, UPDATE, DELETE ON location.cadastral_parcels, location.cadastral_parcel_history, location.cadastral_surveys, location.cadastral_disputes TO location_svc;
