-- Migration: 0001_catalogue_foundation.sql
-- Purpose: Creates the catalogue schema with products (4-level hierarchy + lifecycle),
--          product_availability, rates (effective-dated), eligibility_rules, and bundles.
-- Rollback: DROP SCHEMA catalogue CASCADE; (destructive — use only in dev)
-- Affected services: catalogue-service

SET lock_timeout = '5s';

-- Schema
CREATE SCHEMA IF NOT EXISTS catalogue;

-- ─── Products ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(200) NOT NULL,
  description   varchar(2000),
  line_id       uuid,               -- Level 1: product line
  family_id     uuid,               -- Level 2: product family
  parent_id     uuid,               -- Level 3/4: parent product / variant
  lifecycle_status varchar(32) NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN ('draft','active','suspended','withdrawn','closed_to_new_business')),
  effective_from  date,
  effective_to    date,
  regulatory_metadata jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_tenant_id
  ON catalogue.products (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_tenant_line
  ON catalogue.products (tenant_id, line_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_tenant_status
  ON catalogue.products (tenant_id, lifecycle_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_parent
  ON catalogue.products (parent_id) WHERE parent_id IS NOT NULL;

-- ─── Product Availability ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.product_availability (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  product_id    uuid NOT NULL REFERENCES catalogue.products(id),
  circle_id     uuid,
  region_id     uuid,
  office_id     uuid,
  available     int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_availability_tenant_product
  ON catalogue.product_availability (tenant_id, product_id);

-- ─── Rates (effective-dated) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  product_id    uuid NOT NULL REFERENCES catalogue.products(id),
  effective_date date NOT NULL,
  effective_to   date,
  rate_value    bigint NOT NULL,     -- paise/minor units
  source        varchar(128) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rates_tenant_product
  ON catalogue.rates (tenant_id, product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rates_tenant_effective
  ON catalogue.rates (tenant_id, effective_date);

-- ─── Eligibility Rules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.eligibility_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  product_id    uuid NOT NULL REFERENCES catalogue.products(id),
  rule_type     varchar(64) NOT NULL,
  criteria      jsonb NOT NULL DEFAULT '{}',
  status        varchar(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','deleted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eligibility_rules_tenant_product
  ON catalogue.eligibility_rules (tenant_id, product_id);

-- ─── Bundles ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.bundles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(200) NOT NULL,
  description   varchar(2000),
  component_product_ids jsonb NOT NULL DEFAULT '[]',
  pricing_approval_required boolean NOT NULL DEFAULT false,
  status        varchar(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','deleted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bundles_tenant
  ON catalogue.bundles (tenant_id);

-- ─── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE catalogue.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.products FORCE ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.product_availability FORCE ROW LEVEL SECURITY;
ALTER TABLE catalogue.rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.rates FORCE ROW LEVEL SECURITY;
ALTER TABLE catalogue.eligibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.eligibility_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE catalogue.bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.bundles FORCE ROW LEVEL SECURITY;

-- RLS Policies: filter by current_setting('app.tenant_id')
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'catalogue_products_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY catalogue_products_tenant_isolation ON catalogue.products
      USING (tenant_id::text = current_setting(''app.tenant_id'', true))
      WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'catalogue_availability_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY catalogue_availability_tenant_isolation ON catalogue.product_availability
      USING (tenant_id::text = current_setting(''app.tenant_id'', true))
      WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'catalogue_rates_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY catalogue_rates_tenant_isolation ON catalogue.rates
      USING (tenant_id::text = current_setting(''app.tenant_id'', true))
      WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'catalogue_eligibility_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY catalogue_eligibility_tenant_isolation ON catalogue.eligibility_rules
      USING (tenant_id::text = current_setting(''app.tenant_id'', true))
      WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'catalogue_bundles_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY catalogue_bundles_tenant_isolation ON catalogue.bundles
      USING (tenant_id::text = current_setting(''app.tenant_id'', true))
      WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

-- ─── Grants ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogue_svc') THEN
    GRANT USAGE ON SCHEMA catalogue TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA catalogue TO catalogue_svc;
  END IF;
END $$;
