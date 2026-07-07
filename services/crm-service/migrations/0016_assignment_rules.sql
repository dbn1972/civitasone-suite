-- Purpose: Create assignment_rules table for lead routing engine.
-- Rollback: DROP TABLE IF EXISTS crm.assignment_rules;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  type VARCHAR(24) NOT NULL CHECK (type IN ('territory', 'round_robin', 'score_threshold')),
  criteria JSONB NOT NULL,
  ordinal INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

-- Unique ordinal per tenant (no duplicate priority)
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignment_rules_tenant_ordinal
  ON crm.assignment_rules (tenant_id, ordinal)
  WHERE enabled = true;

-- FK index for tenant_id lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignment_rules_tenant_id
  ON crm.assignment_rules (tenant_id);

-- RLS
ALTER TABLE crm.assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.assignment_rules FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'assignment_rules' AND schemaname = 'crm' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON crm.assignment_rules
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
