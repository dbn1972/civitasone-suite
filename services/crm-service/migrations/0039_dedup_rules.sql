-- Purpose: Create crm.dedup_rules — per-tenant configurable duplicate-matching
--          rules (which fields to match, exact vs fuzzy, weight, threshold,
--          enabled). Backs the admin GET/PUT rules API and the pre-save
--          duplicate-check scorer (DQ-001).
-- Rollback: DROP TABLE IF EXISTS crm.dedup_rules;
-- Affected services: crm-service
-- Sequencing: additive — a new tenant-scoped table with no foreign keys. Rows are
--             seeded lazily per tenant the first time the rules are read, so no
--             backfill is required.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.dedup_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  field varchar(16) NOT NULL
    CHECK (field IN ('email', 'phone', 'gstin', 'pan', 'name', 'company')),
  match_type varchar(8) NOT NULL DEFAULT 'exact'
    CHECK (match_type IN ('exact', 'fuzzy')),
  weight integer NOT NULL DEFAULT 10 CHECK (weight BETWEEN 0 AND 100),
  threshold integer NOT NULL DEFAULT 100 CHECK (threshold BETWEEN 0 AND 100),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

-- One rule per (tenant, field): PUT upserts by field, and lazy seeding inserts
-- ON CONFLICT DO NOTHING against this index so a race cannot double-seed.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_dedup_rules_tenant_field
  ON crm.dedup_rules(tenant_id, field);

ALTER TABLE crm.dedup_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.dedup_rules FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'dedup_rules_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'dedup_rules'
  ) THEN
    CREATE POLICY dedup_rules_tenant_isolation ON crm.dedup_rules
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.dedup_rules TO crm_svc;
  END IF;
END $g$;
