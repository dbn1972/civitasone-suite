-- 0007_missing_module_tables.sql
-- plans, subscriptions, settings and quotas modules are declared in Drizzle
-- (src/modules/plans/schema.ts, src/modules/subscriptions/schema.ts,
-- src/modules/settings/schema.ts, src/modules/quotas/schema.ts) but no
-- migration ever created their tables. Schemas plans/subscriptions/quotas
-- are created by the DB bootstrap (infra/db/bootstrap/bootstrap_missing_schemas.sql
-- — tenant_svc has no CREATE privilege on the database itself, so schema
-- creation has to happen there, as the bootstrapping superuser, not inline
-- in a migration that runs as tenant_svc). Tables (and pgEnum types) here.
-- Columns match the schema.ts files verbatim.
--
-- quotas.quotas specifically: 0010_rls_full_tenant_isolation.sql already had
-- an RLS block for this table, masked by the plans.plans failure it aborted
-- on first — so the table's absence was never observed until that failure
-- was fixed. An earlier pass at this migration deleted the newly-exposed RLS
-- block instead of creating the table it was always meant to cover (quotas
-- is a real, live module — src/modules/quotas/{schema,repo,routes,commands,
-- consumer}.ts, registered in app.ts, routes at /v1/quotas — not a retired
-- one). This restores that block (see 0010) and supplies the table beneath
-- it. Note 0006_quotas.sql predates this module and created an unrelated
-- tenant.tenant_quotas table — a different concept, left untouched.

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

-- ============================================================================
-- quotas.quotas
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE quotas.quota_resource AS ENUM
    ('users', 'storage_gb', 'api_calls_daily', 'documents');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS quotas.quotas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  resource    quotas.quota_resource NOT NULL,
  "limit"     integer NOT NULL,
  used        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_quotas_tenant ON quotas.quotas(tenant_id);
