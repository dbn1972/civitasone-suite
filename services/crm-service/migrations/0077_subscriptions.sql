-- Gap 5: Subscription Management — subscriptions table.
-- Rollback: DROP TABLE IF EXISTS crm.subscriptions;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  product_id uuid NOT NULL,
  type varchar(16) NOT NULL CHECK (type IN ('recurring', 'deposit', 'membership')),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'expired')),
  start_date date NOT NULL,
  next_due_date date,
  frequency varchar(12) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'annual')),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  auto_renew boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_tenant
  ON crm.subscriptions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_contact
  ON crm.subscriptions (tenant_id, contact_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_due
  ON crm.subscriptions (tenant_id, next_due_date) WHERE status = 'active';

ALTER TABLE crm.subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'tenant_isolation_subscriptions'
  ) THEN
    CREATE POLICY tenant_isolation_subscriptions ON crm.subscriptions
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
