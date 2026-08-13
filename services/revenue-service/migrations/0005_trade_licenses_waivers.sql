-- revenue-service migration 0005 — revenue schema: trade_licenses + waivers
-- Applied AFTER 0004_outbox_inbox_durable.sql
-- Rollback: DROP TABLE revenue.waivers, revenue.trade_licenses; DROP SCHEMA revenue;

SET lock_timeout = '5s';

-- ── revenue PG schema ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS revenue;

-- ── revenue.trade_licenses ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue.trade_licenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  license_no      varchar(64) NOT NULL,
  business_name   text NOT NULL,
  proprietor_name text NOT NULL,
  address         text NOT NULL,
  ward_no         varchar(16),
  business_type   varchar(64) NOT NULL,
  category        varchar(32) NOT NULL DEFAULT 'A',
  issued_date     date,
  expiry_date     date,
  status          varchar(32) NOT NULL DEFAULT 'pending',
  fee_minor       text NOT NULL DEFAULT '0',
  fee_paid_minor  text NOT NULL DEFAULT '0',
  renewal_count   integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_trade_licenses_tenant
  ON revenue.trade_licenses(tenant_id, status, is_active);

-- ── revenue.waivers ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue.waivers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  demand_id       uuid NOT NULL,
  amount_minor    bigint NOT NULL,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by    uuid NOT NULL,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_remarks text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waivers_tenant_demand
  ON revenue.waivers(tenant_id, demand_id);

-- ── RLS: trade_licenses ───────────────────────────────────────────────────────
ALTER TABLE revenue.trade_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue.trade_licenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON revenue.trade_licenses;
CREATE POLICY tenant_isolation ON revenue.trade_licenses
  USING      (tenant_id = rates.current_tenant_id())
  WITH CHECK (tenant_id = rates.current_tenant_id());

-- ── RLS: waivers ─────────────────────────────────────────────────────────────
ALTER TABLE revenue.waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue.waivers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON revenue.waivers;
CREATE POLICY tenant_isolation ON revenue.waivers
  USING      (tenant_id = rates.current_tenant_id())
  WITH CHECK (tenant_id = rates.current_tenant_id());

-- ── Grants ────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA revenue TO revenue_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON revenue.trade_licenses TO revenue_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON revenue.waivers TO revenue_svc;
