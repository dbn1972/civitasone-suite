-- Migration: 0013_land_infrastructure.sql
-- Purpose: Land records, spatial support, infrastructure asset registry
-- Rollback: DROP TABLE IF EXISTS location.infrastructure_inspections; DROP TABLE IF EXISTS location.infrastructure_assets; DROP TABLE IF EXISTS location.land_records;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS location.land_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  survey_no varchar(64) NOT NULL,
  khasra_no varchar(64),
  village varchar(128) NOT NULL,
  district varchar(128) NOT NULL,
  area_hectares numeric(12,4) NOT NULL,
  owner_name varchar(256) NOT NULL,
  land_type varchar(32) NOT NULL CHECK (land_type IN ('agricultural','residential','commercial','industrial','government','forest')),
  coordinates jsonb,
  status varchar(16) NOT NULL DEFAULT 'active',
  mutation_date timestamptz,
  mutation_type varchar(32),
  document_ref varchar(256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_land_records_tenant ON location.land_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_land_records_survey ON location.land_records (tenant_id, survey_no);

CREATE TABLE IF NOT EXISTS location.infrastructure_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  type varchar(32) NOT NULL CHECK (type IN ('road','bridge','building','water_supply','drainage','power_line','telecom_tower','park')),
  lat numeric(10,7) NOT NULL,
  lng numeric(10,7) NOT NULL,
  capacity varchar(128),
  condition_score int CHECK (condition_score BETWEEN 1 AND 5),
  status varchar(16) NOT NULL DEFAULT 'active',
  last_inspection_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_infra_assets_tenant ON location.infrastructure_assets (tenant_id);

CREATE TABLE IF NOT EXISTS location.infrastructure_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES location.infrastructure_assets(id),
  inspector_name varchar(200) NOT NULL,
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  condition_score int NOT NULL CHECK (condition_score BETWEEN 1 AND 5),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_infra_inspections_asset ON location.infrastructure_inspections (asset_id, inspection_date DESC);
