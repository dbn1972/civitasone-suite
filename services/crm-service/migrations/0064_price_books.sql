-- Purpose: QP-002 — price books resolved by segment / currency / geography / channel,
--   highest priority wins. price_book_items carry a per-product override price in bigint
--   MINOR units (paise).
-- Rollback: DROP TABLE IF EXISTS crm.price_book_items; DROP TABLE IF EXISTS crm.price_books;
-- Affected services: crm-service (price-books module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.price_books (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       varchar(200) NOT NULL,
  segment    varchar(120),
  currency   char(3) NOT NULL DEFAULT 'INR',
  geography  varchar(120),
  channel    varchar(120),
  -- Higher priority wins when several books match the same criteria.
  priority   integer NOT NULL DEFAULT 0,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version    integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_books_tenant_resolve
  ON crm.price_books (tenant_id, priority DESC) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS crm.price_book_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  price_book_id uuid NOT NULL,
  product_id    uuid NOT NULL,
  price_minor   bigint NOT NULL CHECK (price_minor >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_price_book_items_book_product
  ON crm.price_book_items (tenant_id, price_book_id, product_id);

DO $iso$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['price_books','price_book_items'] LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm' AND tablename=t
        AND policyname = t || '_tenant_isolation') THEN
      EXECUTE format('CREATE POLICY %I ON crm.%I USING (tenant_id::text = current_setting(''app.tenant_id'', true))',
        t || '_tenant_isolation', t);
    END IF;
  END LOOP;
END $iso$;

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.price_books TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.price_book_items TO crm_svc;
  END IF;
END $g$;
