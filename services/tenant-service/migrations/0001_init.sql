-- tenant-service initial migration. Applied with the tenant_svc role on civitas_tenant.
-- Schemas (tenant, _outbox, _inbox) are created by the DB bootstrap; tables here.

CREATE TABLE IF NOT EXISTS tenant.tenants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(200) NOT NULL,
  domain       varchar(253) NOT NULL UNIQUE,
  edition      varchar(32)  NOT NULL,
  status       varchar(24)  NOT NULL DEFAULT 'draft',
  region       varchar(64)  NOT NULL,
  residency    varchar(64)  NOT NULL,
  settings     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenant.tenants(status);

-- transactional outbox (write path durability)
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

-- consumer idempotency log
CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
