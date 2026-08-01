-- Purpose: Add governance versioning, lifecycle states, regulatory metadata,
--          enhanced availability, bundle approvals, and cross-sell rules tables.
-- Rollback: DROP TABLE catalogue.cross_sell_rules, catalogue.bundle_approvals,
--           catalogue.product_availability_v2, catalogue.regulatory_metadata,
--           catalogue.product_lifecycle, catalogue.product_versions;
-- Affected services: catalogue-service

SET lock_timeout = '5s';

-- PC-001: Governed Versioned Product Master with Approval
CREATE TABLE IF NOT EXISTS catalogue.product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  version_number int NOT NULL DEFAULT 1,
  status varchar(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected')),
  change_summary text,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_versions_product
  ON catalogue.product_versions (tenant_id, product_id, version_number);

-- PC-002: Product Lifecycle States
CREATE TABLE IF NOT EXISTS catalogue.product_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  state varchar(32) NOT NULL
    CHECK (state IN ('active', 'sunset', 'closed_to_new_business', 'retired')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_lifecycle_product
  ON catalogue.product_lifecycle (tenant_id, product_id, effective_from DESC);

-- PC-003: Regulatory Metadata per Product
CREATE TABLE IF NOT EXISTS catalogue.regulatory_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  regulation varchar(200) NOT NULL,
  compliance_status varchar(24) NOT NULL DEFAULT 'pending_review'
    CHECK (compliance_status IN ('compliant', 'non_compliant', 'pending_review')),
  notes text,
  reviewed_at timestamptz,
  reviewer_id uuid,
  version int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regulatory_metadata_product
  ON catalogue.regulatory_metadata (tenant_id, product_id);

-- PC-004: Enhanced availability with region/office codes + effective dates
CREATE TABLE IF NOT EXISTS catalogue.product_availability_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  region_code varchar(50),
  office_code varchar(50),
  available boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  version int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_availability_v2_product
  ON catalogue.product_availability_v2 (tenant_id, product_id);

-- PC-006: Bundle Approvals
CREATE TABLE IF NOT EXISTS catalogue.bundle_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bundle_id uuid NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bundle_approvals_bundle
  ON catalogue.bundle_approvals (tenant_id, bundle_id);

-- PC-008: Cross-Sell Relationships
CREATE TABLE IF NOT EXISTS catalogue.cross_sell_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_product_id uuid NOT NULL,
  target_product_id uuid NOT NULL,
  rule_type varchar(24) NOT NULL DEFAULT 'cross_sell'
    CHECK (rule_type IN ('cross_sell', 'upsell', 'complementary')),
  priority int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_rules_source
  ON catalogue.cross_sell_rules (tenant_id, source_product_id, enabled);

-- RLS + GRANT
ALTER TABLE catalogue.product_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE catalogue.product_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_lifecycle FORCE ROW LEVEL SECURITY;

ALTER TABLE catalogue.regulatory_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.regulatory_metadata FORCE ROW LEVEL SECURITY;

ALTER TABLE catalogue.product_availability_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_availability_v2 FORCE ROW LEVEL SECURITY;

ALTER TABLE catalogue.bundle_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.bundle_approvals FORCE ROW LEVEL SECURITY;

ALTER TABLE catalogue.cross_sell_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.cross_sell_rules FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogue_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON catalogue.product_versions TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.product_lifecycle TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.regulatory_metadata TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.product_availability_v2 TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.bundle_approvals TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalogue.cross_sell_rules TO catalogue_svc;
  END IF;
END $$;

-- RLS policies (tenant isolation)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'product_versions_tenant') THEN
    CREATE POLICY product_versions_tenant ON catalogue.product_versions
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'product_lifecycle_tenant') THEN
    CREATE POLICY product_lifecycle_tenant ON catalogue.product_lifecycle
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'regulatory_metadata_tenant') THEN
    CREATE POLICY regulatory_metadata_tenant ON catalogue.regulatory_metadata
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'product_availability_v2_tenant') THEN
    CREATE POLICY product_availability_v2_tenant ON catalogue.product_availability_v2
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'bundle_approvals_tenant') THEN
    CREATE POLICY bundle_approvals_tenant ON catalogue.bundle_approvals
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cross_sell_rules_tenant') THEN
    CREATE POLICY cross_sell_rules_tenant ON catalogue.cross_sell_rules
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
