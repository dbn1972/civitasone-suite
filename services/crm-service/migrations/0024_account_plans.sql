-- Purpose: Create crm.account_plans for strategic account planning (KA-001).
--          Holds yearly objectives, white-space (cross/up-sell) analysis and risks.
-- Rollback: DROP TABLE IF EXISTS crm.account_plans;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.account_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  plan_year integer NOT NULL,
  objectives jsonb NOT NULL DEFAULT '[]',
  white_space jsonb NOT NULL DEFAULT '[]',
  risks jsonb NOT NULL DEFAULT '[]',
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  -- One plan per account per year: the plan IS the yearly artefact, so a second
  -- row for the same year would mean two competing sources of truth.
  CONSTRAINT account_plans_tenant_account_year_uk UNIQUE (tenant_id, account_id, plan_year)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_plans_tenant_id ON crm.account_plans(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_plans_account_id ON crm.account_plans(account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_plans_status ON crm.account_plans(tenant_id, status);

ALTER TABLE crm.account_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.account_plans FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'account_plans_tenant_isolation' AND tablename = 'account_plans'
  ) THEN
    CREATE POLICY account_plans_tenant_isolation ON crm.account_plans
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.account_plans TO crm_svc;
  END IF;
END $g$;
