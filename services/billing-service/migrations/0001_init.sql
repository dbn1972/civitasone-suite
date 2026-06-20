-- billing-service initial migration. Applied with billing_svc on civitas_billing.

CREATE SCHEMA IF NOT EXISTS plans;
CREATE SCHEMA IF NOT EXISTS subscriptions;
CREATE SCHEMA IF NOT EXISTS usage;
CREATE SCHEMA IF NOT EXISTS invoices;
CREATE SCHEMA IF NOT EXISTS payments;

-- ── plans module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plans.billing_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  name         text NOT NULL,
  code         text NOT NULL UNIQUE,
  price_minor  bigint NOT NULL DEFAULT 0,
  currency     char(3) NOT NULL DEFAULT 'INR',
  govt_exempt  boolean NOT NULL DEFAULT true,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plans.billing_plan_features (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  plan_id      uuid NOT NULL,
  feature_key  text NOT NULL,
  limit_value  bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (plan_id, feature_key)
);

-- ── subscriptions module ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions.billing_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  plan_id      uuid NOT NULL,
  status       varchar(24) NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial','active','suspended','cancelled')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS subscriptions.billing_trials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  subscription_id uuid NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (subscription_id)
);

-- ── usage module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage.billing_usage_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  metric_key   text NOT NULL,
  quantity     bigint NOT NULL DEFAULT 1,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_billing_usage_events_tenant ON usage.billing_usage_events(tenant_id, recorded_at);

CREATE TABLE IF NOT EXISTS usage.billing_usage_aggregates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  metric_key   text NOT NULL,
  period_month char(7) NOT NULL,
  total_quantity bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, metric_key, period_month)
);

-- ── invoices module ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoices.billing_invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  period_month char(7) NOT NULL,
  status       varchar(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','paid','overdue','waived')),
  total_minor  bigint NOT NULL DEFAULT 0,
  currency     char(3) NOT NULL DEFAULT 'INR',
  issued_at    timestamptz,
  paid_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, period_month)
);

CREATE TABLE IF NOT EXISTS invoices.billing_invoice_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  invoice_id   uuid NOT NULL,
  description  text NOT NULL,
  amount_minor bigint NOT NULL DEFAULT 0,
  currency     char(3) NOT NULL DEFAULT 'INR',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_billing_invoice_items_invoice ON invoices.billing_invoice_items(invoice_id);

-- ── payments module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments.billing_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  invoice_id   uuid NOT NULL,
  amount_minor bigint NOT NULL DEFAULT 0,
  currency     char(3) NOT NULL DEFAULT 'INR',
  method       varchar(32) NOT NULL DEFAULT 'gateway',
  status       varchar(24) NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments.billing_gateway_txns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  payment_id   uuid NOT NULL,
  gateway      varchar(32) NOT NULL DEFAULT 'razorpay',
  gateway_ref  text,
  status       varchar(24) NOT NULL DEFAULT 'initiated',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

-- transactional outbox + inbox
CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid NOT NULL,
  actor_id       uuid NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
