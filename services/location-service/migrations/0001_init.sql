-- location-service initial migration. Applied with location_svc on civitas_location.

CREATE TABLE IF NOT EXISTS location.locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(200) NOT NULL,
  address_line varchar(500),
  city         varchar(120),
  postal_code  varchar(16),
  status       varchar(24)  NOT NULL DEFAULT 'active',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON location.locations(tenant_id);

GRANT USAGE ON SCHEMA location TO location_svc;
GRANT ALL ON ALL TABLES IN SCHEMA location TO location_svc;
GRANT ALL ON ALL SEQUENCES IN SCHEMA location TO location_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA location GRANT ALL ON TABLES TO location_svc;

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
