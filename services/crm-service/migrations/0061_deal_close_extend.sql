-- Purpose: OP-006 — close an opportunity as won | lost | cancelled | on_hold with a
--   mandatory reason and (for losses) competitor capture. close_outcome records the
--   business closure distinctly from deals.status (whose 'cancelled' value is already
--   used by soft-delete), so a cancelled/on-hold closure stays visible in reporting.
--   crm.deal_close_policy makes "competitor mandatory on loss" a per-tenant switch.
-- Rollback: DROP TABLE IF EXISTS crm.deal_close_policy;
--   ALTER TABLE crm.deals DROP COLUMN IF EXISTS close_outcome,
--   DROP COLUMN IF EXISTS close_competitor, DROP COLUMN IF EXISTS closed_at_on_hold;
-- Affected services: crm-service (deals module)

SET lock_timeout = '5s';

ALTER TABLE crm.deals
  ADD COLUMN IF NOT EXISTS close_outcome    varchar(16)
    CHECK (close_outcome IS NULL OR close_outcome IN ('won','lost','cancelled','on_hold')),
  ADD COLUMN IF NOT EXISTS close_competitor jsonb;

CREATE TABLE IF NOT EXISTS crm.deal_close_policy (
  tenant_id                   uuid PRIMARY KEY,
  -- When true, closing a deal as 'lost' requires at least one competitor.
  competitor_required_on_loss boolean NOT NULL DEFAULT false,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid NOT NULL
);

ALTER TABLE crm.deal_close_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.deal_close_policy FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='deal_close_policy' AND policyname='deal_close_policy_tenant_isolation') THEN
    CREATE POLICY deal_close_policy_tenant_isolation ON crm.deal_close_policy
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.deal_close_policy TO crm_svc;
  END IF;
END $g$;

-- Widen the status domain so an on-hold closure is a valid state (was:
-- active|won|lost|cancelled). 'deleted' is included to match the read-path filters
-- that already exclude it.
ALTER TABLE crm.deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE crm.deals ADD CONSTRAINT deals_status_check
  CHECK (status IN ('active','won','lost','cancelled','on_hold','deleted'));
