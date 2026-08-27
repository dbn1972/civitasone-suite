-- 0007_missing_module_tables.sql
-- plans, subscriptions and settings modules are declared in Drizzle
-- (src/modules/plans/schema.ts, src/modules/subscriptions/schema.ts,
-- src/modules/settings/schema.ts) but no migration ever created their
-- tables. Schemas plans/subscriptions/settings are created by the DB
-- bootstrap; tables (and pgEnum types) here. Columns match the schema.ts
-- files verbatim.

-- ============================================================================
-- plans.plans
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE plans.edition AS ENUM ('small_office', 'psu', 'govt_dept');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE plans.billing_cycle AS ENUM ('monthly', 'quarterly', 'annual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS plans.plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  code             varchar(64) NOT NULL UNIQUE,
  name             varchar(200) NOT NULL,
  edition          plans.edition NOT NULL,
  max_users        integer NOT NULL,
  max_storage_gb   integer NOT NULL,
  enabled_modules  jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_minor      bigint NOT NULL,
  billing_cycle    plans.billing_cycle NOT NULL DEFAULT 'annual',
  features         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_plans_tenant ON plans.plans(tenant_id);

-- ============================================================================
-- subscriptions.subscriptions
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE subscriptions.subscription_status AS ENUM
    ('trial', 'active', 'past_due', 'suspended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS subscriptions.subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  plan_id               uuid NOT NULL,
  status                subscriptions.subscription_status NOT NULL DEFAULT 'trial',
  start_date            timestamptz NOT NULL,
  end_date              timestamptz,
  trial_ends_at         timestamptz,
  current_period_start  timestamptz NOT NULL,
  current_period_end    timestamptz NOT NULL,
  cancelled_at          timestamptz,
  cancel_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions.subscriptions(tenant_id);
-- Note: the plan_id lookup index is added later by 0013_fk_indexes.sql (CONCURRENTLY).

-- ============================================================================
-- settings.tenant_settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS settings.tenant_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  key         varchar(128) NOT NULL,
  value       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NOT NULL,
  created_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant ON settings.tenant_settings(tenant_id);
