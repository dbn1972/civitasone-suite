-- identity-service initial migration. Applied with identity_svc role on civitas_identity.
-- Schemas (users, sessions, mfa, service_accounts, _outbox, _inbox) created by DB bootstrap.

CREATE TABLE IF NOT EXISTS users.users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  email        varchar(254) NOT NULL,
  name         varchar(200) NOT NULL,
  emp_code     varchar(64),
  status       varchar(24)  NOT NULL DEFAULT 'active',  -- active | suspended | locked | deactivated
  mfa_enabled  boolean      NOT NULL DEFAULT false,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users.users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users.users(status);

CREATE TABLE IF NOT EXISTS users.service_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(200) NOT NULL,
  scopes       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  rotated_at   timestamptz,
  status       varchar(24)  NOT NULL DEFAULT 'active',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_service_accounts_tenant_id ON users.service_accounts(tenant_id);

CREATE TABLE IF NOT EXISTS sessions.sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  ip           varchar(45)  NOT NULL,
  device       varchar(256),
  mfa_method   varchar(32),
  trusted      boolean      NOT NULL DEFAULT false,
  status       varchar(24)  NOT NULL DEFAULT 'active',  -- active | revoked | expired
  started_at   timestamptz  NOT NULL DEFAULT now(),
  expires_at   timestamptz  NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions.sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions.sessions(status);

CREATE TABLE IF NOT EXISTS mfa.configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL UNIQUE,
  method       varchar(32)  NOT NULL DEFAULT 'totp',  -- totp | sms | email
  secret       varchar(512),
  enabled      boolean      NOT NULL DEFAULT false,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_mfa_configs_tenant_id ON mfa.configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mfa_configs_user_id ON mfa.configs(user_id);

-- transactional outbox
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
