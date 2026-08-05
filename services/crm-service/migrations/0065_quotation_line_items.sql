-- Purpose: QP-003 — quotation line items sourced from the product catalogue, stored
--   relationally (the JSONB line_items on crm.quotations stays as a denormalised
--   snapshot for the document). All money is bigint MINOR units (paise); line_total is
--   persisted so a quote total can be recomputed without float.
-- Rollback: DROP TABLE IF EXISTS crm.quotation_line_items;
-- Affected services: crm-service (quotations module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.quotation_line_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  quotation_id     uuid NOT NULL,
  product_id       uuid,
  description      varchar(500) NOT NULL,
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  tax_rate_bps     integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 100000),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  ordinal          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotation_line_items_quotation
  ON crm.quotation_line_items (tenant_id, quotation_id, ordinal);

ALTER TABLE crm.quotation_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.quotation_line_items FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='quotation_line_items' AND policyname='quotation_line_items_tenant_isolation') THEN
    CREATE POLICY quotation_line_items_tenant_isolation ON crm.quotation_line_items
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.quotation_line_items TO crm_svc;
  END IF;
END $g$;
