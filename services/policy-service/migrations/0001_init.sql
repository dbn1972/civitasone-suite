-- policy-service initial migration. Applied with policy_svc role on civitas_policy.
-- Schemas (roles, bindings, abac, _outbox, _inbox) created by DB bootstrap.

CREATE TABLE IF NOT EXISTS roles.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  name        varchar(128) NOT NULL,
  description varchar(500),
  status      varchar(24)  NOT NULL DEFAULT 'active',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL,
  version     integer      NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_tenant_name ON roles.roles(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON roles.roles(tenant_id);

CREATE TABLE IF NOT EXISTS roles.permissions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  role_id    uuid        NOT NULL,
  resource   varchar(128) NOT NULL,
  action     varchar(64)  NOT NULL,
  effect     varchar(8)   NOT NULL DEFAULT 'allow',
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  created_by uuid         NOT NULL,
  updated_by uuid         NOT NULL,
  version    integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_permissions_role_id ON roles.permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_permissions_tenant_id ON roles.permissions(tenant_id);

CREATE TABLE IF NOT EXISTS bindings.bindings (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id   uuid NOT NULL,
  role_id   uuid NOT NULL,
  status    varchar(24) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_user_role ON bindings.bindings(tenant_id, user_id, role_id);
CREATE INDEX IF NOT EXISTS idx_bindings_tenant_id ON bindings.bindings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bindings_user_id ON bindings.bindings(user_id);

CREATE TABLE IF NOT EXISTS bindings.breakglass (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  requester_id  uuid        NOT NULL,
  reason        text        NOT NULL,
  scope         varchar(256) NOT NULL,
  granted_until timestamptz NOT NULL,
  status        varchar(24)  NOT NULL DEFAULT 'pending',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_breakglass_tenant_id ON bindings.breakglass(tenant_id);
CREATE INDEX IF NOT EXISTS idx_breakglass_status ON bindings.breakglass(status);

CREATE TABLE IF NOT EXISTS abac.rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  role_id    uuid NOT NULL,
  expression text NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_abac_role_id ON abac.rules(role_id);
CREATE INDEX IF NOT EXISTS idx_abac_tenant_id ON abac.rules(tenant_id);

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
