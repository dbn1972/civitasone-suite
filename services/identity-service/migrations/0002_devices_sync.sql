-- Device registration + Gmail-style sync cursors (identity-service)

CREATE SCHEMA IF NOT EXISTS devices AUTHORIZATION identity_svc;
CREATE SCHEMA IF NOT EXISTS sync AUTHORIZATION identity_svc;

CREATE TABLE IF NOT EXISTS devices.registered_devices (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  platform        VARCHAR(16) NOT NULL,
  label           TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  trust_token     TEXT NOT NULL,
  trust_level     VARCHAR(24) NOT NULL DEFAULT 'recognized',
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, user_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS sync.mailbox_cursors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  device_id       UUID NOT NULL,
  mailbox         VARCHAR(32) NOT NULL,
  cursor_value    TEXT NOT NULL DEFAULT '0',
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, device_id, mailbox)
);

CREATE TABLE IF NOT EXISTS sync.entity_changelog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  mailbox         VARCHAR(32) NOT NULL,
  entity_id       UUID NOT NULL,
  operation       VARCHAR(16) NOT NULL,
  payload         JSONB,
  etag            TEXT NOT NULL,
  seq             BIGSERIAL NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, mailbox, entity_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_changelog_mailbox_seq ON sync.entity_changelog (tenant_id, mailbox, seq);
