-- notification-service initial migration. Applied with notification_svc role on civitas_notification.
-- Schemas (templates, deliveries, _outbox, _inbox) created by DB bootstrap.

CREATE TABLE IF NOT EXISTS templates.templates (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  channel    varchar(32) NOT NULL,   -- email | sms | push | in_app
  name       varchar(128) NOT NULL,
  subject    varchar(256),
  body       text        NOT NULL,
  status     varchar(24) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_templates_tenant_id ON templates.templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_templates_channel ON templates.templates(channel);

CREATE TABLE IF NOT EXISTS templates.prefs (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid    NOT NULL,
  user_id    uuid    NOT NULL,
  event_type varchar(128) NOT NULL,
  in_app     boolean NOT NULL DEFAULT true,
  email      boolean NOT NULL DEFAULT true,
  push       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid    NOT NULL,
  updated_by uuid    NOT NULL,
  version    integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prefs_user_event ON templates.prefs(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_prefs_tenant_id ON templates.prefs(tenant_id);

CREATE TABLE IF NOT EXISTS deliveries.deliveries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  template_id uuid        NOT NULL,
  recipient   varchar(254) NOT NULL,
  channel     varchar(32) NOT NULL,
  status      varchar(24) NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant_id ON deliveries.deliveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries.deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_recipient ON deliveries.deliveries(recipient);

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
