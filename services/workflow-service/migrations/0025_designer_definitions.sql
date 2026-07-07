-- Purpose: Create designer_definitions table for BPMN visual designer canvas state.
-- Rollback: DROP TABLE IF EXISTS workflow.designer_definitions;
-- Affected services: workflow-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS workflow.designer_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  description VARCHAR(2000),
  elements JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL,
  CONSTRAINT designer_definitions_status_check CHECK (status IN ('draft', 'published', 'deleted'))
);

-- Indexes for common access patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_designer_definitions_tenant_status
  ON workflow.designer_definitions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_designer_definitions_tenant_updated
  ON workflow.designer_definitions (tenant_id, updated_at DESC);

-- RLS enforcement
ALTER TABLE workflow.designer_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.designer_definitions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'designer_definitions' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON workflow.designer_definitions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
