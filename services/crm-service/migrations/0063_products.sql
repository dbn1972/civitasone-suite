-- Purpose: QP-001 — product / service catalogue. Only active (active_from/active_to
--   window) and enabled products may be placed on a quotation line item.
--   price_minor is bigint MINOR units (paise); no float ever touches a money value.
-- Rollback: DROP TABLE IF EXISTS crm.products;
-- Affected services: crm-service (products module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  category     varchar(120),
  code         varchar(64) NOT NULL,
  name         varchar(200) NOT NULL,
  unit         varchar(32) NOT NULL DEFAULT 'unit',
  tax_rate_bps integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 100000),
  price_minor  bigint NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency     char(3) NOT NULL DEFAULT 'INR',
  active_from  date,
  active_to    date,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

-- Product code is the tenant-facing identity; unique per tenant.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_products_tenant_code
  ON crm.products (tenant_id, code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_tenant_enabled
  ON crm.products (tenant_id) WHERE enabled = true;

ALTER TABLE crm.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.products FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='products' AND policyname='products_tenant_isolation') THEN
    CREATE POLICY products_tenant_isolation ON crm.products
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.products TO crm_svc;
  END IF;
END $g$;
