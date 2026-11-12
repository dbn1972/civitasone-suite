-- 0036_plan_modules_and_prices.sql
-- M6 (module-sale gap): plans and prices linked to modules. Additive + idempotent; nothing existing changes.
--
--  1. plans.plans.catalogue_modules: the catalogue module ids a plan is sold as (NULL = derive from enabled_modules
--     through the catalogue's product map, which is what every existing plan keeps doing).
--  2. plans.plan_prices: effective-dated, append-only price store. Price per plan and per add-on module, in INR
--     minor units (paise, net of GST), with the GST rate stored on the row so GST is shown separately on a quote.
--     Same tenant scoping + FORCED RLS as plans.plans (the plan catalogue is held per tenant).
-- Price history is effective-dated, close-and-insert: setting a new price closes the previous open row (effective_to) and
-- inserts a new one; the guard trigger below refuses every other UPDATE and every DELETE. NOTE for tenant erasure: the
-- trigger also refuses the DELETE a purge would issue, so a future erasure job must run as the owner with the trigger
-- disabled for that transaction (ALTER TABLE ... DISABLE TRIGGER trg_plan_prices_guard) or drop the tenant schema rows
-- another way. Decide that before the first erasure run.
-- Apply as the OWNING service role (tenant_svc), like 0001-0035: the table is created owned by whoever runs this and the
-- service must own it. Do not apply as a superuser or the immutability trigger and RLS would belong to the wrong role.
SET lock_timeout = '5s';

ALTER TABLE plans.plans ADD COLUMN IF NOT EXISTS catalogue_modules jsonb;

CREATE TABLE IF NOT EXISTS plans.plan_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  subject_kind   varchar(8)  NOT NULL CHECK (subject_kind IN ('plan', 'addon')),
  -- plan: the plan code; addon: the catalogue module id
  subject_key    varchar(64) NOT NULL,
  billing_cycle  plans.billing_cycle NOT NULL DEFAULT 'annual',
  currency       char(3)     NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  -- net price in paise, GST excluded
  amount_minor   bigint      NOT NULL CHECK (amount_minor >= 0),
  -- GST in basis points (1800 = 18%), shown separately on a quote
  gst_rate_bps   integer     NOT NULL DEFAULT 1800 CHECK (gst_rate_bps BETWEEN 0 AND 10000),
  effective_from date        NOT NULL,
  effective_to   date,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  CONSTRAINT chk_plan_prices_window CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT uq_plan_prices_start UNIQUE (tenant_id, subject_kind, subject_key, billing_cycle, effective_from)
);
-- at most one open-ended price per subject and cycle (a new price closes the previous one)
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_one_open
  ON plans.plan_prices (tenant_id, subject_kind, subject_key, billing_cycle) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_plan_prices_lookup
  ON plans.plan_prices (tenant_id, subject_kind, subject_key, billing_cycle, effective_from DESC);

ALTER TABLE plans.plan_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans.plan_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plans.plan_prices;
CREATE POLICY tenant_isolation_policy ON plans.plan_prices
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- Price history is immutable at the database: DELETE is refused, and the only UPDATE allowed is closing an open price
-- once (effective_to NULL -> a date on or after effective_from) with every other column unchanged.
CREATE OR REPLACE FUNCTION plans.plan_prices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'plans.plan_prices is append-only: DELETE refused' USING ERRCODE = '42501';
  END IF;
  IF OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL
     AND (NEW.id, NEW.tenant_id, NEW.subject_kind, NEW.subject_key, NEW.billing_cycle, NEW.currency, NEW.amount_minor,
          NEW.gst_rate_bps, NEW.effective_from, NEW.note, NEW.created_at, NEW.created_by)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.tenant_id, OLD.subject_kind, OLD.subject_key, OLD.billing_cycle, OLD.currency, OLD.amount_minor,
          OLD.gst_rate_bps, OLD.effective_from, OLD.note, OLD.created_at, OLD.created_by) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'plans.plan_prices is append-only: only closing an open price once is allowed' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_plan_prices_guard ON plans.plan_prices;
CREATE TRIGGER trg_plan_prices_guard BEFORE UPDATE OR DELETE ON plans.plan_prices
  FOR EACH ROW EXECUTE FUNCTION plans.plan_prices_guard();
