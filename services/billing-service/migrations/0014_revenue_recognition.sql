-- Purpose: Create revenue recognition ledger and daily accrual tables
-- Rollback: DROP TABLE IF EXISTS revenue.revenue_accruals; DROP TABLE IF EXISTS revenue.revenue_ledger; DROP SCHEMA IF EXISTS revenue;
-- Affected services: billing-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS revenue;

-- Revenue recognition ledger — one entry per subscription per service period
CREATE TABLE IF NOT EXISTS revenue.revenue_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  total_amount_paise BIGINT NOT NULL,
  service_period_start DATE NOT NULL,
  service_period_end DATE NOT NULL,
  total_days INT NOT NULL,
  recognized_paise BIGINT NOT NULL DEFAULT 0,
  deferred_paise BIGINT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_revenue_ledger_status CHECK (status IN ('active', 'completed', 'cancelled')),
  CONSTRAINT chk_revenue_ledger_total_positive CHECK (total_amount_paise >= 0),
  CONSTRAINT chk_revenue_ledger_days_positive CHECK (total_days >= 1),
  CONSTRAINT chk_revenue_ledger_recognized_non_negative CHECK (recognized_paise >= 0),
  CONSTRAINT chk_revenue_ledger_deferred_non_negative CHECK (deferred_paise >= 0)
);

-- Daily accrual entries — one row per ledger per calendar day
CREATE TABLE IF NOT EXISTS revenue.revenue_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ledger_id UUID NOT NULL REFERENCES revenue.revenue_ledger(id),
  accrual_date DATE NOT NULL,
  amount_paise BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_revenue_accruals_amount_positive CHECK (amount_paise >= 0)
);

-- Indexes for common queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_ledger_tenant
  ON revenue.revenue_ledger (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_ledger_subscription
  ON revenue.revenue_ledger (tenant_id, subscription_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_accruals_ledger
  ON revenue.revenue_accruals (ledger_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_accruals_tenant_date
  ON revenue.revenue_accruals (tenant_id, accrual_date);

-- Unique constraint: one accrual per ledger per date
CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_accruals_ledger_date
  ON revenue.revenue_accruals (ledger_id, accrual_date);

-- RLS enforcement
ALTER TABLE revenue.revenue_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue.revenue_ledger FORCE ROW LEVEL SECURITY;

ALTER TABLE revenue.revenue_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue.revenue_accruals FORCE ROW LEVEL SECURITY;

-- Tenant isolation policies (safe: returns NULL when GUC unset → zero rows, no error)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'revenue_ledger' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON revenue.revenue_ledger
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'revenue_accruals' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON revenue.revenue_accruals
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

-- Grant permissions to the billing service role
GRANT USAGE ON SCHEMA revenue TO billing_svc;
GRANT ALL ON ALL TABLES IN SCHEMA revenue TO billing_svc;
GRANT ALL ON ALL SEQUENCES IN SCHEMA revenue TO billing_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA revenue GRANT ALL ON TABLES TO billing_svc;
