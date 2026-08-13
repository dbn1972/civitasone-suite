-- Migration: 0023_geofence_schema.sql
-- Purpose: tenant-scoped geofence registry (office/site/zone)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS geofence AUTHORIZATION location_svc;

DO $$ BEGIN
  CREATE TYPE geofence.geofence_type AS ENUM ('office', 'site', 'zone');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS geofence.geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  type geofence.geofence_type NOT NULL,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius_meters INTEGER NOT NULL,
  polygon JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_geofences_tenant ON geofence.geofences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_geofences_active ON geofence.geofences(tenant_id, active);
