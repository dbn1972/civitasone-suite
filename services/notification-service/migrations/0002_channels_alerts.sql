-- notification-service extension: channels, alerts, bulk, template versioning, delivery retry.
-- Applied with notification_svc role on civitas_notification.

CREATE SCHEMA IF NOT EXISTS channels AUTHORIZATION notification_svc;
CREATE SCHEMA IF NOT EXISTS alerts   AUTHORIZATION notification_svc;
CREATE SCHEMA IF NOT EXISTS bulk     AUTHORIZATION notification_svc;

-- ── channels ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channels.channels (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  type       varchar(32) NOT NULL,
  name       varchar(128) NOT NULL,
  is_default boolean     NOT NULL DEFAULT false,
  enabled    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1,
  CONSTRAINT chk_channels_type CHECK (type IN ('email', 'sms', 'push', 'in_app', 'whatsapp'))
);
CREATE INDEX IF NOT EXISTS idx_channels_tenant_id ON channels.channels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_channels_type ON channels.channels(type);

CREATE TABLE IF NOT EXISTS channels.channel_configs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  channel_id uuid        NOT NULL REFERENCES channels.channels(id),
  config_key varchar(128) NOT NULL,
  config_val text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_channel_configs_channel_id ON channels.channel_configs(channel_id);

-- ── alerts ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts.alert_rules (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  name           varchar(128) NOT NULL,
  trigger_event  text        NOT NULL,
  conditions     jsonb       NOT NULL DEFAULT '{}',
  channel        text        NOT NULL,
  recipients     jsonb       NOT NULL DEFAULT '[]',
  enabled        boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant_id ON alerts.alert_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_trigger ON alerts.alert_rules(trigger_event);

CREATE TABLE IF NOT EXISTS alerts.alert_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  rule_id    uuid        NOT NULL REFERENCES alerts.alert_rules(id),
  payload    jsonb       NOT NULL DEFAULT '{}',
  status     varchar(24) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule_id ON alerts.alert_events(rule_id);

-- ── bulk campaigns ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bulk.campaigns (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  template_id uuid        NOT NULL,
  name        varchar(128) NOT NULL,
  status      varchar(24) NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT chk_campaigns_status CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_id ON bulk.campaigns(tenant_id);

CREATE TABLE IF NOT EXISTS bulk.campaign_recipients (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  campaign_id  uuid        NOT NULL REFERENCES bulk.campaigns(id),
  recipient_id varchar(254) NOT NULL,
  status       varchar(24) NOT NULL DEFAULT 'pending',
  delivery_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  updated_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_id ON bulk.campaign_recipients(campaign_id);

-- ── template versioning ───────────────────────────────────────────────────────

ALTER TABLE templates.templates
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES templates.templates(id);

CREATE INDEX IF NOT EXISTS idx_templates_superseded_by ON templates.templates(superseded_by);

-- ── delivery retry ────────────────────────────────────────────────────────────

ALTER TABLE deliveries.deliveries
  ADD COLUMN IF NOT EXISTS retry_count   integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_detail  text;

-- migrate legacy statuses to new vocabulary
UPDATE deliveries.deliveries SET status = 'queued'    WHERE status = 'pending';
UPDATE deliveries.deliveries SET status = 'delivered' WHERE status = 'sent';

ALTER TABLE deliveries.deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_status;
ALTER TABLE deliveries.deliveries
  ADD CONSTRAINT chk_deliveries_status
  CHECK (status IN ('queued', 'sending', 'delivered', 'failed', 'skipped'));

ALTER TABLE deliveries.deliveries ALTER COLUMN status SET DEFAULT 'queued';
