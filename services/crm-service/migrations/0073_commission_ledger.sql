-- Gap 1: Incentive/Commission Tracking — commission ledger table.
-- Rollback: DROP TABLE IF EXISTS crm.commission_ledger;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.commission_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'disputed')),
  period varchar(10) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  paid_at timestamptz
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commission_ledger_tenant
  ON crm.commission_ledger (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commission_ledger_agent
  ON crm.commission_ledger (tenant_id, agent_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commission_ledger_period
  ON crm.commission_ledger (tenant_id, period);

ALTER TABLE crm.commission_ledger ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'commission_ledger' AND policyname = 'tenant_isolation_commission_ledger'
  ) THEN
    CREATE POLICY tenant_isolation_commission_ledger ON crm.commission_ledger
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
