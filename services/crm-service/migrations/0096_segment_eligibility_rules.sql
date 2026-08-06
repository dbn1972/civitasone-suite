-- G6: Segment eligibility rules — product×segment eligibility + channel overrides.
-- Connects segment_definitions (G5) to the recommendation engine by determining which
-- products are eligible for cross-sell within each segment and overriding delivery channels.
-- Rollback: DROP TABLE IF EXISTS crm.segment_eligibility_rules;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.segment_eligibility_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  segment_code varchar(64) NOT NULL,
  product_id uuid NOT NULL,
  eligible boolean NOT NULL DEFAULT true,
  channel_override jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_seg_elig_rules_tenant_seg_product
  ON crm.segment_eligibility_rules (tenant_id, segment_code, product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seg_elig_rules_tenant
  ON crm.segment_eligibility_rules (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seg_elig_rules_segment
  ON crm.segment_eligibility_rules (tenant_id, segment_code);

ALTER TABLE crm.segment_eligibility_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'segment_eligibility_rules' AND policyname = 'tenant_isolation_seg_elig_rules'
  ) THEN
    CREATE POLICY tenant_isolation_seg_elig_rules ON crm.segment_eligibility_rules
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
