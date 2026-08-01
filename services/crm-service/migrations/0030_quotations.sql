-- Purpose: Create crm.quotations — template-driven quotations with versioning
--          and acceptance tracking (QP-003, QP-005).
-- Rollback: DROP TABLE IF EXISTS crm.quotations;
-- Affected services: crm-service
--
-- Money note: total_minor is bigint MINOR units (paise). Routes cast it to text
-- so values above 2^53 survive JSON serialisation exactly; line-item sums are
-- computed with BigInt in src/modules/deals/quotation-domain.ts.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  deal_id uuid,
  quote_ref varchar(120) NOT NULL,
  template_ref varchar(120),
  version_number integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  total_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'INR',
  valid_until timestamptz,
  line_items jsonb NOT NULL DEFAULT '[]',
  reject_reason text,
  sent_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  -- A quote reference plus its revision number is the customer-facing identity.
  CONSTRAINT quotations_tenant_ref_version_uk UNIQUE (tenant_id, quote_ref, version_number)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_tenant_id ON crm.quotations(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_deal_id ON crm.quotations(deal_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_status ON crm.quotations(tenant_id, status);

ALTER TABLE crm.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.quotations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'quotations_tenant_isolation' AND tablename = 'quotations'
  ) THEN
    CREATE POLICY quotations_tenant_isolation ON crm.quotations
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.quotations TO crm_svc;
  END IF;
END $g$;
