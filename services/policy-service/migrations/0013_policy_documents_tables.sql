-- 0013_policy_documents_tables.sql
--
-- policies.policies / policies.policy_versions / policies.policy_acknowledgments
-- are declared in Drizzle (src/modules/policies/schema.ts) and queried by the
-- live routes in src/modules/policies/routes.ts (GET/POST /v1/policy/policies,
-- versions, acknowledgements), but no migration ever created them, so every
-- one of those routes answered 500 (`relation "policies.policies" does not
-- exist`). Found by scripts/ci/schema-drift-guard.mjs (32 declared columns
-- with no database counterpart). Columns match schema.ts verbatim.
--
-- The `policies` schema itself is created by infra/db/bootstrap/
-- bootstrap_missing_schemas.sql (policy_svc has no CREATE privilege on the
-- database), alongside role_features.
--
-- Additive and idempotent. Rollback:
--   DROP TABLE IF EXISTS policies.policy_acknowledgments, policies.policy_versions, policies.policies;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS policies.policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  title          varchar(512) NOT NULL,
  slug           varchar(256) NOT NULL,
  category       varchar(128) NOT NULL DEFAULT 'general',
  tags           text[] NOT NULL DEFAULT '{}',
  content        text NOT NULL DEFAULT '',
  status         varchar(32) NOT NULL DEFAULT 'draft',
  owner_id       uuid,
  published_at   timestamptz,
  archived_at    timestamptz,
  effective_from timestamptz,
  effective_to   timestamptz,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policies_policies_tenant        ON policies.policies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_policies_policies_tenant_status ON policies.policies (tenant_id, status);

CREATE TABLE IF NOT EXISTS policies.policy_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id   uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  version_num integer NOT NULL,
  content     text NOT NULL DEFAULT '',
  status      varchar(32) NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policies_policy_versions_tenant ON policies.policy_versions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_policies_policy_versions_policy ON policies.policy_versions (tenant_id, policy_id);

CREATE TABLE IF NOT EXISTS policies.policy_acknowledgments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id  uuid NOT NULL,
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  acked_at   timestamptz NOT NULL DEFAULT now(),
  ip_address varchar(64)
);
-- routes.ts upserts on (policy_id, user_id): ON CONFLICT needs this unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_acknowledgments_policy_user
  ON policies.policy_acknowledgments (policy_id, user_id);
CREATE INDEX IF NOT EXISTS idx_policies_policy_acknowledgments_tenant
  ON policies.policy_acknowledgments (tenant_id);

-- Tenant isolation (same NULL-safe accessor as 0003_rls_full_tenant_isolation.sql).
ALTER TABLE policies.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies.policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON policies.policies;
CREATE POLICY tenant_isolation_policy ON policies.policies
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE policies.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies.policy_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON policies.policy_versions;
CREATE POLICY tenant_isolation_policy ON policies.policy_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE policies.policy_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies.policy_acknowledgments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON policies.policy_acknowledgments;
CREATE POLICY tenant_isolation_policy ON policies.policy_acknowledgments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
