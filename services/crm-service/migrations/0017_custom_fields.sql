-- Purpose: Create custom_fields table for tenant-configurable field definitions (Req 8.8)
-- Rollback: DROP TABLE IF EXISTS crm.custom_fields;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entity_type VARCHAR(24) NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  field_type VARCHAR(24) NOT NULL,
  validation_schema JSONB,
  ordinal INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

-- Constraint: entity_type must be one of the allowed values
ALTER TABLE crm.custom_fields
  ADD CONSTRAINT chk_custom_fields_entity_type
  CHECK (entity_type IN ('leads', 'contacts', 'deals'));

-- Constraint: field_type must be one of the allowed values
ALTER TABLE crm.custom_fields
  ADD CONSTRAINT chk_custom_fields_field_type
  CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select', 'multi_select'));

-- Index for listing by tenant + entity type (query pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_custom_fields_tenant_entity
  ON crm.custom_fields (tenant_id, entity_type, ordinal);

-- RLS enforcement
ALTER TABLE crm.custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.custom_fields FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm.custom_fields
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
