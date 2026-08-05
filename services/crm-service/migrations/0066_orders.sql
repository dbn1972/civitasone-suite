-- Purpose: QP-005 — convert an accepted quotation into an order. crm.orders is the
--   handoff record; total_minor is bigint MINOR units (paise). Version history stays on
--   crm.quotations (each revision is its own row) so the order references the exact
--   quotation revision it was raised from.
-- Rollback: DROP TABLE IF EXISTS crm.orders;
-- Affected services: crm-service (quotations module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  quotation_id          uuid NOT NULL,
  quotation_version     integer NOT NULL,
  deal_id               uuid,
  order_ref             varchar(140) NOT NULL,
  status                varchar(16) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','fulfilled','cancelled')),
  total_minor           bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  currency              char(3) NOT NULL DEFAULT 'INR',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

-- One order per quotation revision: a re-fired convert is idempotent, not a duplicate.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_orders_tenant_quotation
  ON crm.orders (tenant_id, quotation_id);

ALTER TABLE crm.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.orders FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='orders' AND policyname='orders_tenant_isolation') THEN
    CREATE POLICY orders_tenant_isolation ON crm.orders
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.orders TO crm_svc;
  END IF;
END $g$;
