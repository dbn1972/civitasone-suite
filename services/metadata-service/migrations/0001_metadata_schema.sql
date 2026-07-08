-- Migration: 0001_metadata_schema.sql
-- Purpose: Core metadata engine tables (entity definitions, fields, layouts, records)
-- Rollback: DROP SCHEMA IF EXISTS metadata CASCADE;
-- Safety: additive, idempotent (IF NOT EXISTS throughout)

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS metadata;

-- ── Entity Definitions ────────────────────────────────────────────────────────
-- Tenant-scoped custom object definitions (like Salesforce Custom Objects)
CREATE TABLE IF NOT EXISTS metadata.entity_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  api_name VARCHAR(128) NOT NULL,          -- e.g. "custom_vehicle", "custom_project_phase"
  label VARCHAR(256) NOT NULL,             -- human-readable name
  plural_label VARCHAR(256) NOT NULL,
  description TEXT,
  icon VARCHAR(64) DEFAULT 'cube',
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  UNIQUE (tenant_id, api_name)
);

ALTER TABLE metadata.entity_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.entity_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON metadata.entity_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Field Definitions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metadata.field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entity_def_id UUID NOT NULL REFERENCES metadata.entity_definitions(id),
  api_name VARCHAR(128) NOT NULL,          -- e.g. "registration_number", "capacity"
  label VARCHAR(256) NOT NULL,
  field_type VARCHAR(32) NOT NULL,         -- text, number, currency, date, boolean, picklist, lookup, formula
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_unique BOOLEAN NOT NULL DEFAULT false,
  default_value JSONB,                      -- type-appropriate default
  validation_rule JSONB,                    -- { expression, errorMessage }
  picklist_values JSONB,                    -- for picklist type: ["val1", "val2", ...]
  lookup_entity_id UUID,                    -- for lookup type: target entity_def_id
  formula_expression TEXT,                  -- for formula type: safe expression
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  UNIQUE (entity_def_id, api_name)
);

ALTER TABLE metadata.field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.field_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON metadata.field_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Layout Definitions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metadata.layout_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entity_def_id UUID NOT NULL REFERENCES metadata.entity_definitions(id),
  layout_type VARCHAR(32) NOT NULL DEFAULT 'detail',  -- detail, list, create, edit
  sections JSONB NOT NULL DEFAULT '[]',    -- [{ label, columns, fields: [field_api_name, ...] }]
  is_default BOOLEAN NOT NULL DEFAULT false,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL
);

ALTER TABLE metadata.layout_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.layout_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON metadata.layout_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Custom Records (dynamic data storage) ─────────────────────────────────────
-- All custom object instances stored here. JSONB data column indexed with GIN.
CREATE TABLE IF NOT EXISTS metadata.custom_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entity_def_id UUID NOT NULL REFERENCES metadata.entity_definitions(id),
  data JSONB NOT NULL DEFAULT '{}',        -- { field_api_name: value, ... }
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL
);

ALTER TABLE metadata.custom_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.custom_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON metadata.custom_records
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- GIN index on JSONB data for fast field-level queries
CREATE INDEX IF NOT EXISTS idx_custom_records_data_gin
  ON metadata.custom_records USING GIN (data);

-- Composite index for entity + tenant (common query pattern)
CREATE INDEX IF NOT EXISTS idx_custom_records_entity_tenant
  ON metadata.custom_records (entity_def_id, tenant_id);

-- ── Validation Rules ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metadata.validation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entity_def_id UUID NOT NULL REFERENCES metadata.entity_definitions(id),
  name VARCHAR(256) NOT NULL,
  expression TEXT NOT NULL,                -- safe expression: "field_a > 0 AND field_b != null"
  error_message VARCHAR(512) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL
);

ALTER TABLE metadata.validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.validation_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON metadata.validation_rules
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
