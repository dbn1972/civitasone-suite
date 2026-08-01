-- Migration: 0006_price_books.sql
-- Purpose: QP-002 — price books by segment, currency and geography, plus their
--          per-product entries. All money is stored as bigint MINOR UNITS
--          (paise) and is serialised as a STRING in JSON; the application layer
--          does arithmetic with BigInt(). No float, no numeric-as-number.
--
-- Rollback (manual, requires tech-lead approval):
--   DROP TABLE IF EXISTS catalogue.price_book_entries;
--   DROP TABLE IF EXISTS catalogue.price_books;
--
-- Affected services: catalogue-service

SET lock_timeout = '5s';

-- ─── Price books ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.price_books (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  name           varchar(200) NOT NULL,
  segment        varchar(64) NOT NULL,
  currency       char(3) NOT NULL,
  -- Free-form geography selector, e.g. {"circleCode":"KA","regionCode":"BLR"}.
  geography      jsonb NOT NULL DEFAULT '{}',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  status         varchar(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_books_tenant
  ON catalogue.price_books (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_books_resolve
  ON catalogue.price_books (tenant_id, segment, currency, status);

-- ─── Price book entries ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.price_book_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  price_book_id uuid NOT NULL REFERENCES catalogue.price_books(id),
  product_id    uuid NOT NULL,
  -- MONEY RULE: minor units (paise) as bigint. Exact above 2^53; serialised as a
  -- JSON string by the route layer so JavaScript number precision is never used.
  amount_minor  bigint NOT NULL,
  currency      char(3) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1,
  CONSTRAINT uq_price_book_entries_book_product UNIQUE (tenant_id, price_book_id, product_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_book_entries_product
  ON catalogue.price_book_entries (tenant_id, product_id);

COMMENT ON COLUMN catalogue.price_book_entries.amount_minor IS 'Price in minor units (paise) as bigint. Serialised as a JSON string. Never a float.';

-- ─── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE catalogue.price_books        ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.price_books        FORCE  ROW LEVEL SECURITY;
ALTER TABLE catalogue.price_book_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.price_book_entries FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'price_books' AND policyname = 'catalogue_price_books_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY catalogue_price_books_tenant_isolation ON catalogue.price_books
      USING (tenant_id::text = current_setting(''app.tenant_id'', true))
      WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'price_book_entries' AND policyname = 'catalogue_price_book_entries_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY catalogue_price_book_entries_tenant_isolation ON catalogue.price_book_entries
      USING (tenant_id::text = current_setting(''app.tenant_id'', true))
      WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

-- ─── Guarded GRANT (never creates a LOGIN role) ────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogue_svc') THEN
    GRANT USAGE ON SCHEMA catalogue TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.price_books        TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalogue.price_book_entries TO catalogue_svc;
  END IF;
END $$;
