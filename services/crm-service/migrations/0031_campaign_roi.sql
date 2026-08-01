-- Purpose: Create crm.campaign_performance — campaign responses, cost and
--          revenue per period for ROI reporting (MK-004).
-- Rollback: DROP TABLE IF EXISTS crm.campaign_performance;
-- Affected services: crm-service
--
-- Money note: cost_minor / revenue_minor are bigint MINOR units (paise). ROI is
-- computed as an integer basis-points value with BigInt arithmetic — never a
-- float — in src/modules/dashboard/roi-domain.ts.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.campaign_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  responses integer NOT NULL DEFAULT 0,
  cost_minor bigint NOT NULL DEFAULT 0,
  revenue_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'INR',
  period_start date,
  period_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  -- One performance row per campaign per reporting period; the PUT upserts on
  -- this key so replayed connector feeds do not double-count spend.
  CONSTRAINT campaign_performance_tenant_campaign_period_uk UNIQUE (tenant_id, campaign_id, period_start)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaign_performance_tenant_id ON crm.campaign_performance(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaign_performance_campaign_id ON crm.campaign_performance(campaign_id);

ALTER TABLE crm.campaign_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.campaign_performance FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'campaign_performance_tenant_isolation' AND tablename = 'campaign_performance'
  ) THEN
    CREATE POLICY campaign_performance_tenant_isolation ON crm.campaign_performance
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.campaign_performance TO crm_svc;
  END IF;
END $g$;
