-- Purpose: Create crm.tenders for tender/RFP tracking with bid stages (KA-003).
-- Rollback: DROP TABLE IF EXISTS crm.tenders;
-- Affected services: crm-service
--
-- Money note: estimated_value_minor is bigint MINOR units (paise). It is never
-- read as a JS number — routes cast it to text so it round-trips exactly above
-- 2^53. See src/modules/deals/tenders-routes.ts.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  account_id uuid,
  tender_ref varchar(120) NOT NULL,
  title varchar(300) NOT NULL,
  bid_stage varchar(20) NOT NULL DEFAULT 'identified'
    CHECK (bid_stage IN ('identified', 'qualified', 'bid_prepared', 'submitted', 'won', 'lost')),
  submission_deadline timestamptz,
  estimated_value_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'INR',
  competitors jsonb NOT NULL DEFAULT '[]',
  loss_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  -- The tender reference is the publishing authority's identifier: duplicates
  -- inside one tenant would double-count pipeline value.
  CONSTRAINT tenders_tenant_ref_uk UNIQUE (tenant_id, tender_ref)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenders_tenant_id ON crm.tenders(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenders_account_id ON crm.tenders(account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenders_stage ON crm.tenders(tenant_id, bid_stage);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenders_deadline ON crm.tenders(tenant_id, submission_deadline);

ALTER TABLE crm.tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.tenders FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tenders_tenant_isolation' AND tablename = 'tenders'
  ) THEN
    CREATE POLICY tenders_tenant_isolation ON crm.tenders
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.tenders TO crm_svc;
  END IF;
END $g$;
