-- Migration: 0017_limitation_rules
-- Purpose: Create the limitations schema and limitation_rules table for statutory deadline tracking.
-- Rollback: DROP TABLE IF EXISTS limitations.limitation_rules; DROP SCHEMA IF EXISTS limitations;
-- Affected services: legal-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS limitations;

CREATE TABLE IF NOT EXISTS limitations.limitation_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  matter_id   UUID NOT NULL,
  rule_type   VARCHAR(64) NOT NULL,
  start_date  TIMESTAMPTZ NOT NULL,
  period_days INT NOT NULL CHECK (period_days > 0),
  deadline    TIMESTAMPTZ NOT NULL,
  status      VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  notifications JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INT NOT NULL DEFAULT 1
);

-- RLS enforcement
ALTER TABLE limitations.limitation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitations.limitation_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON limitations.limitation_rules;
CREATE POLICY tenant_isolation ON limitations.limitation_rules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_limitation_rules_tenant_id ON limitations.limitation_rules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_limitation_rules_matter_id ON limitations.limitation_rules (matter_id);
CREATE INDEX IF NOT EXISTS idx_limitation_rules_deadline ON limitations.limitation_rules (deadline);
CREATE INDEX IF NOT EXISTS idx_limitation_rules_status ON limitations.limitation_rules (status);
