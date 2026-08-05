-- Gap 1: Incentive/Commission Tracking — commission rules table.
-- Rollback: DROP TABLE IF EXISTS crm.commission_rules;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  type varchar(16) NOT NULL CHECK (type IN ('referral', 'sale', 'renewal')),
  rate_type varchar(16) NOT NULL CHECK (rate_type IN ('percentage', 'fixed')),
  rate_value bigint NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commission_rules_tenant
  ON crm.commission_rules (tenant_id);

ALTER TABLE crm.commission_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'commission_rules' AND policyname = 'tenant_isolation_commission_rules'
  ) THEN
    CREATE POLICY tenant_isolation_commission_rules ON crm.commission_rules
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
