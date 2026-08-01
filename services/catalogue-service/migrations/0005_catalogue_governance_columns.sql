-- Migration: 0005_catalogue_governance_columns.sql
-- Purpose: Additive column/constraint support for the governance, lifecycle,
--          regulatory, availability, external-rate-master, bundle-approval,
--          cross-sell and QP-001 product-classification API surface. The tables
--          themselves were created by 0004; this migration only adds the audit /
--          workflow / classification columns those endpoints need, plus the
--          database-level guards (self-cross-sell CHECK, uniqueness) that back
--          the 422 responses in the route layer.
--
--          BRD: PC-001, PC-002, PC-003, PC-004, PC-005, PC-006, PC-008, QP-001.
--
-- Rollback (manual, requires tech-lead approval — all steps are DROPs):
--   ALTER TABLE catalogue.product_versions
--     DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS submitted_by,
--     DROP COLUMN IF EXISTS rejected_by, DROP COLUMN IF EXISTS rejected_at,
--     DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE catalogue.regulatory_metadata
--     DROP COLUMN IF EXISTS valid_from, DROP COLUMN IF EXISTS valid_until,
--     DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS created_at,
--     DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS updated_at;
--   DROP INDEX IF EXISTS catalogue.uq_regulatory_metadata_product;
--   ALTER TABLE catalogue.product_availability_v2
--     DROP COLUMN IF EXISTS circle_code, DROP COLUMN IF EXISTS created_by,
--     DROP COLUMN IF EXISTS created_at, DROP COLUMN IF EXISTS updated_by,
--     DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE catalogue.rates
--     DROP COLUMN IF EXISTS source_system, DROP COLUMN IF EXISTS external_id,
--     DROP COLUMN IF EXISTS synced_at;
--   ALTER TABLE catalogue.bundle_approvals
--     DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS decided_at,
--     DROP COLUMN IF EXISTS pricing_amount_minor, DROP COLUMN IF EXISTS currency,
--     DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE catalogue.cross_sell_rules
--     DROP CONSTRAINT IF EXISTS ck_cross_sell_no_self_reference,
--     DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS created_at,
--     DROP COLUMN IF EXISTS note;
--   DROP INDEX IF EXISTS catalogue.uq_cross_sell_rules_pair;
--   ALTER TABLE catalogue.products
--     DROP CONSTRAINT IF EXISTS ck_products_tax_rate_bps_range,
--     DROP COLUMN IF EXISTS product_code, DROP COLUMN IF EXISTS category,
--     DROP COLUMN IF EXISTS tax_rate_bps;
--   DROP INDEX IF EXISTS catalogue.uq_products_tenant_product_code;
--
-- Affected services: catalogue-service

SET lock_timeout = '5s';

-- ─── PC-001: product_versions — maker-checker audit columns ────────────────────
-- `created_by` (already present in 0004) is the MAKER. `approved_by` /
-- `rejected_by` are the CHECKER and are enforced != created_by in the route layer.
ALTER TABLE catalogue.product_versions
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_by  uuid,
  ADD COLUMN IF NOT EXISTS rejected_at  timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by   uuid;

COMMENT ON COLUMN catalogue.product_versions.submitted_by IS 'Actor who moved the version draft -> pending_approval.';
COMMENT ON COLUMN catalogue.product_versions.rejected_by IS 'Checker who rejected the version. Must differ from created_by (maker-checker).';

-- ─── PC-003: regulatory_metadata — validity window + audit columns ─────────────
ALTER TABLE catalogue.regulatory_metadata
  ADD COLUMN IF NOT EXISTS valid_from  timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS created_by  uuid,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by  uuid,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN catalogue.regulatory_metadata.valid_until IS 'End of the regulatory validity window. Drives GET /v1/catalogue/regulatory/expiring.';

-- One regulatory record per product per tenant: PUT .../regulatory is an upsert
-- keyed on (tenant_id, product_id), so the uniqueness must be enforced by the DB.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_regulatory_metadata_product
  ON catalogue.regulatory_metadata (tenant_id, product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regulatory_metadata_valid_until
  ON catalogue.regulatory_metadata (tenant_id, valid_until)
  WHERE valid_until IS NOT NULL;

-- ─── PC-004: product_availability_v2 — circle level + audit columns ────────────
-- 0004 created region_code + office_code only. The BRD requires a three-level
-- circle/region/office hierarchy so that the lookup can resolve most-specific-wins.
ALTER TABLE catalogue.product_availability_v2
  ADD COLUMN IF NOT EXISTS circle_code varchar(50),
  ADD COLUMN IF NOT EXISTS created_by  uuid,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by  uuid,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN catalogue.product_availability_v2.circle_code IS 'Broadest availability scope. NULL = applies to every circle (tenant-wide default row).';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_availability_v2_lookup
  ON catalogue.product_availability_v2 (tenant_id, product_id, circle_code, region_code, office_code);

-- ─── PC-005: rates mastered in an external system ──────────────────────────────
ALTER TABLE catalogue.rates
  ADD COLUMN IF NOT EXISTS source_system varchar(128),
  ADD COLUMN IF NOT EXISTS external_id   varchar(200),
  ADD COLUMN IF NOT EXISTS synced_at     timestamptz;

COMMENT ON COLUMN catalogue.rates.source_system IS 'External master of record for this rate (e.g. CBS, FINACLE). NULL = mastered in CivitasOne.';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rates_external_ref
  ON catalogue.rates (tenant_id, source_system, external_id)
  WHERE source_system IS NOT NULL;

-- ─── PC-006: bundle_approvals — decision + priced amount ───────────────────────
ALTER TABLE catalogue.bundle_approvals
  ADD COLUMN IF NOT EXISTS decided_by           uuid,
  ADD COLUMN IF NOT EXISTS decided_at           timestamptz,
  ADD COLUMN IF NOT EXISTS pricing_amount_minor bigint,
  ADD COLUMN IF NOT EXISTS currency             char(3),
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN catalogue.bundle_approvals.pricing_amount_minor IS 'Proposed bundle price in minor units (paise). bigint — never float.';
COMMENT ON COLUMN catalogue.bundle_approvals.decided_by IS 'Checker who decided. Must differ from requested_by (maker-checker).';

-- ─── PC-008: cross_sell_rules — audit columns + self-reference guard ───────────
ALTER TABLE catalogue.cross_sell_rules
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS note       varchar(500);

-- A product may never cross-sell itself. The route returns 422, but the DB is the
-- last line of defence. Added NOT VALID then validated so existing rows (if any
-- violate) do not block the migration; validation is a light, non-blocking scan.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_cross_sell_no_self_reference'
      AND conrelid = 'catalogue.cross_sell_rules'::regclass
  ) THEN
    ALTER TABLE catalogue.cross_sell_rules
      ADD CONSTRAINT ck_cross_sell_no_self_reference
      CHECK (source_product_id <> target_product_id) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_cross_sell_no_self_reference'
      AND conrelid = 'catalogue.cross_sell_rules'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE catalogue.cross_sell_rules
      VALIDATE CONSTRAINT ck_cross_sell_no_self_reference;
  END IF;
END $$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_cross_sell_rules_pair
  ON catalogue.cross_sell_rules (tenant_id, source_product_id, target_product_id, rule_type);

-- ─── QP-001: product code / category / tax rate ────────────────────────────────
-- tax_rate_bps is BASIS POINTS as an INTEGER (1200 = 12.00%). Never a float —
-- percentages are exact in bps and survive round-tripping without drift.
ALTER TABLE catalogue.products
  ADD COLUMN IF NOT EXISTS product_code varchar(64),
  ADD COLUMN IF NOT EXISTS category     varchar(100),
  ADD COLUMN IF NOT EXISTS tax_rate_bps int NOT NULL DEFAULT 0;

COMMENT ON COLUMN catalogue.products.product_code IS 'Human-facing catalogue code, unique per tenant. NULL until assigned.';
COMMENT ON COLUMN catalogue.products.tax_rate_bps IS 'Tax rate in basis points (integer). 1200 = 12.00%. Never a float.';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_products_tax_rate_bps_range'
      AND conrelid = 'catalogue.products'::regclass
  ) THEN
    ALTER TABLE catalogue.products
      ADD CONSTRAINT ck_products_tax_rate_bps_range
      CHECK (tax_rate_bps >= 0 AND tax_rate_bps <= 10000) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_products_tax_rate_bps_range'
      AND conrelid = 'catalogue.products'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE catalogue.products VALIDATE CONSTRAINT ck_products_tax_rate_bps_range;
  END IF;
END $$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_products_tenant_product_code
  ON catalogue.products (tenant_id, product_code)
  WHERE product_code IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_tenant_category
  ON catalogue.products (tenant_id, category)
  WHERE category IS NOT NULL;

-- ─── RLS re-assert (idempotent; tables created in 0001/0004) ───────────────────
ALTER TABLE catalogue.product_versions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_versions          FORCE  ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_lifecycle         ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_lifecycle         FORCE  ROW LEVEL SECURITY;
ALTER TABLE catalogue.regulatory_metadata       ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.regulatory_metadata       FORCE  ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_availability_v2   ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_availability_v2   FORCE  ROW LEVEL SECURITY;
ALTER TABLE catalogue.bundle_approvals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.bundle_approvals          FORCE  ROW LEVEL SECURITY;
ALTER TABLE catalogue.cross_sell_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.cross_sell_rules          FORCE  ROW LEVEL SECURITY;

-- 0004 created the tenant policies with USING only. Add the matching WITH CHECK
-- policies so INSERT/UPDATE cannot write a row belonging to another tenant.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'product_versions' AND policyname = 'product_versions_tenant_write') THEN
    EXECUTE 'CREATE POLICY product_versions_tenant_write ON catalogue.product_versions
      FOR INSERT WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'product_lifecycle' AND policyname = 'product_lifecycle_tenant_write') THEN
    EXECUTE 'CREATE POLICY product_lifecycle_tenant_write ON catalogue.product_lifecycle
      FOR INSERT WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'regulatory_metadata' AND policyname = 'regulatory_metadata_tenant_write') THEN
    EXECUTE 'CREATE POLICY regulatory_metadata_tenant_write ON catalogue.regulatory_metadata
      FOR INSERT WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'product_availability_v2' AND policyname = 'product_availability_v2_tenant_write') THEN
    EXECUTE 'CREATE POLICY product_availability_v2_tenant_write ON catalogue.product_availability_v2
      FOR INSERT WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'bundle_approvals' AND policyname = 'bundle_approvals_tenant_write') THEN
    EXECUTE 'CREATE POLICY bundle_approvals_tenant_write ON catalogue.bundle_approvals
      FOR INSERT WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'cross_sell_rules' AND policyname = 'cross_sell_rules_tenant_write') THEN
    EXECUTE 'CREATE POLICY cross_sell_rules_tenant_write ON catalogue.cross_sell_rules
      FOR INSERT WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

-- ─── Guarded GRANT (never creates a LOGIN role) ────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogue_svc') THEN
    GRANT USAGE ON SCHEMA catalogue TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.products                TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.rates                   TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.product_versions        TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.product_lifecycle       TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.regulatory_metadata     TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalogue.product_availability_v2 TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.bundle_approvals        TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalogue.cross_sell_rules TO catalogue_svc;
  END IF;
END $$;
