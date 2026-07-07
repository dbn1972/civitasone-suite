-- Migration: Add automation_rules table for configurable trigger→action rules.
-- Rollback: DROP TABLE IF EXISTS helpdesk.automation_rules;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  ordinal INT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  trigger JSONB NOT NULL,
  actions JSONB NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1,

  CONSTRAINT chk_automation_rules_status CHECK (status IN ('active', 'deleted'))
);

-- Indexes for performant rule lookup per tenant
CREATE INDEX IF NOT EXISTS idx_automation_rules_tenant_ordinal
  ON helpdesk.automation_rules (tenant_id, ordinal)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_automation_rules_tenant_status
  ON helpdesk.automation_rules (tenant_id, status);

-- RLS (uses the shared helpdesk.current_tenant_id() function from migration 0006)
ALTER TABLE helpdesk.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.automation_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.automation_rules;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.automation_rules;
CREATE POLICY tenant_isolation_policy ON helpdesk.automation_rules
  USING (tenant_id = helpdesk.current_tenant_id())
  WITH CHECK (tenant_id = helpdesk.current_tenant_id());
