-- install-service initial migration. Applied with the install_svc role on civitas_install.

CREATE TABLE IF NOT EXISTS install.stages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(128) NOT NULL,
  step_number  integer      NOT NULL,
  description  varchar(500),
  status       varchar(24)  NOT NULL DEFAULT 'active',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_stages_tenant ON install.stages(tenant_id);

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), topic varchar(128) NOT NULL, event_type varchar(128) NOT NULL,
  tenant_id uuid NOT NULL, actor_id uuid NOT NULL, correlation_id varchar(64) NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id uuid PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now()
);
