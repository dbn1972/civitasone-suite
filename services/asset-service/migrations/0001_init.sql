-- asset-service initial migration
-- Applied with asset_svc role on civitas_asset.

CREATE SCHEMA IF NOT EXISTS register;
CREATE SCHEMA IF NOT EXISTS lifecycle;
CREATE SCHEMA IF NOT EXISTS depreciation;
CREATE SCHEMA IF NOT EXISTS maintenance;
CREATE SCHEMA IF NOT EXISTS insurance;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ── register module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS register.asset_categories (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  code             text        NOT NULL,
  name             text        NOT NULL,
  useful_life_years integer    NOT NULL DEFAULT 5,
  dep_rate         numeric(8,4) NOT NULL DEFAULT 20.0,
  dep_method       varchar(8)  NOT NULL DEFAULT 'SLM'
                               CHECK (dep_method IN ('SLM','WDV')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS register.asset_assets (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  code             text        NOT NULL,
  category_id      uuid        NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','under_maintenance','transferred','disposed','written_off')),
  acquisition_cost bigint      NOT NULL DEFAULT 0,
  salvage_value    bigint      NOT NULL DEFAULT 0,
  useful_life_years integer    NOT NULL DEFAULT 5,
  dep_rate         numeric(8,4) NOT NULL DEFAULT 20.0,
  dep_method       varchar(8)  NOT NULL DEFAULT 'SLM'
                               CHECK (dep_method IN ('SLM','WDV')),
  currency         char(3)     NOT NULL DEFAULT 'INR',
  book_value       bigint      NOT NULL DEFAULT 0,
  accumulated_dep  bigint      NOT NULL DEFAULT 0,
  acquisition_date date        NOT NULL,
  po_ref           text,
  grn_ref          text,
  location         text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_assets_tenant_status ON register.asset_assets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_category      ON register.asset_assets(category_id);

-- ── lifecycle module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lifecycle.asset_acquisitions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  acquisition_date date        NOT NULL,
  cost_minor       bigint      NOT NULL,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  vendor_id        text,
  po_ref           text,
  grn_ref          text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lifecycle.asset_transfers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  from_location    text        NOT NULL,
  to_location      text        NOT NULL,
  transfer_date    date        NOT NULL,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lifecycle.asset_disposals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  disposal_date    date        NOT NULL,
  disposal_method  varchar(32) NOT NULL DEFAULT 'sale',
  proceeds_minor   bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  gain_loss_minor  bigint      NOT NULL DEFAULT 0,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── depreciation module ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS depreciation.asset_dep_schedules (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  method           varchar(8)  NOT NULL DEFAULT 'SLM'
                               CHECK (method IN ('SLM','WDV')),
  rate             numeric(8,4) NOT NULL,
  useful_life_years integer    NOT NULL,
  start_date       date        NOT NULL,
  end_date         date        NOT NULL,
  original_cost_minor bigint   NOT NULL,
  salvage_minor    bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(16) NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','completed','cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, asset_id)
);

CREATE TABLE IF NOT EXISTS depreciation.asset_dep_entries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  schedule_id      uuid        NOT NULL,
  period           char(7)     NOT NULL,
  amount_minor     bigint      NOT NULL,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  book_value_after_minor bigint NOT NULL,
  posted_at        timestamptz,
  gl_ref           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, asset_id, period)
);

CREATE INDEX IF NOT EXISTS idx_dep_entries_period ON depreciation.asset_dep_entries(period) WHERE posted_at IS NULL;

-- ── maintenance module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance.asset_maintenance_plans (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  frequency        varchar(16) NOT NULL DEFAULT 'monthly',
  next_due         date,
  last_done        date,
  description      text,
  status           varchar(16) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS maintenance.asset_work_orders (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  plan_id          uuid,
  scheduled_date   date        NOT NULL,
  completed_date   date,
  status           varchar(16) NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open','in_progress','completed','cancelled')),
  cost_minor       bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── insurance module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insurance.asset_policies (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  policy_no        text        NOT NULL,
  insurer          text        NOT NULL,
  coverage_minor   bigint      NOT NULL DEFAULT 0,
  premium_minor    bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  start_date       date        NOT NULL,
  end_date         date        NOT NULL,
  renewal_reminder_days integer NOT NULL DEFAULT 30,
  status           varchar(16) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, policy_no)
);

CREATE TABLE IF NOT EXISTS insurance.asset_claims (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  policy_id        uuid        NOT NULL,
  asset_id         uuid        NOT NULL,
  claim_date       date        NOT NULL,
  claim_amount_minor bigint    NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(16) NOT NULL DEFAULT 'pending',
  settled_amount_minor bigint  NOT NULL DEFAULT 0,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── outbox / inbox ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid         NOT NULL,
  actor_id       uuid         NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb        NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_asset_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
