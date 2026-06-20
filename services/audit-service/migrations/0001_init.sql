-- audit-service initial migration. Applied with audit_svc role on civitas_audit.
-- Schemas (events, exports, _outbox, _inbox) created by DB bootstrap.
-- events.events is APPEND-ONLY — no UPDATE or DELETE.

CREATE TABLE IF NOT EXISTS events.events (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid         NOT NULL,
  type           varchar(128) NOT NULL,
  actor          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  target         varchar(256),
  payload        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  severity       varchar(16)  NOT NULL DEFAULT 'info',
  prev_hash      varchar(64),
  event_hash     varchar(64),
  correlation_id varchar(64),
  occurred_at    timestamptz  NOT NULL DEFAULT now(),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  created_by     uuid         NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_id ON events.events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON events.events(type);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON events.events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_occurred ON events.events(tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS exports.exports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  period_from     timestamptz NOT NULL,
  period_to       timestamptz NOT NULL,
  format          varchar(16) NOT NULL DEFAULT 'json',
  signed_url      text,
  retention_until timestamptz,
  status          varchar(24) NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_exports_tenant_id ON exports.exports(tenant_id);

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
