-- 0009_rbac.sql — IAM RBAC core (wave 2). Additive + idempotent.
-- Tables: rbac.roles, rbac.permissions, rbac.role_permissions,
--         rbac.role_assignments, rbac.role_assignment_history (append-only).
-- All tenant-scoped; optimistic-locked via version; audited via outbox.

CREATE SCHEMA IF NOT EXISTS rbac;

CREATE TABLE IF NOT EXISTS rbac.roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  key         VARCHAR(64)  NOT NULL,
  name        VARCHAR(200) NOT NULL,
  description VARCHAR(500),
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rbac_roles_tenant_key ON rbac.roles (tenant_id, key);

CREATE TABLE IF NOT EXISTS rbac.permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  key         VARCHAR(128) NOT NULL,
  name        VARCHAR(200) NOT NULL,
  description VARCHAR(500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rbac_permissions_tenant_key ON rbac.permissions (tenant_id, key);

CREATE TABLE IF NOT EXISTS rbac.role_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  role_id       UUID NOT NULL,
  permission_id UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rbac_role_permissions ON rbac.role_permissions (tenant_id, role_id, permission_id);
CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_role ON rbac.role_permissions (tenant_id, role_id);

CREATE TABLE IF NOT EXISTS rbac.role_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  role_id     UUID NOT NULL,
  user_id     UUID NOT NULL,
  status      VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rbac_role_assignments ON rbac.role_assignments (tenant_id, role_id, user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_role_assignments_user ON rbac.role_assignments (tenant_id, user_id, status);

-- Append-only history. No UPDATE/DELETE expected; one row per mutation.
CREATE TABLE IF NOT EXISTS rbac.role_assignment_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  role_id      UUID NOT NULL,
  user_id      UUID NOT NULL,
  action       VARCHAR(24) NOT NULL,          -- 'assign' | 'revoke'
  actor_id     UUID NOT NULL,
  reason       VARCHAR(500),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rbac_rah_user ON rbac.role_assignment_history (tenant_id, user_id, recorded_at);
